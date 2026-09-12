// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

//! Synchronised windows: what you do in one profile, every other profile in
//! the group does too — in its own way.
//!
//! The agency's daily job is warming a batch of accounts: open twenty profiles,
//! visit the same platform, scroll, click around, log in. Done by hand that is
//! twenty times the work; done by a recorded script it is twenty identical
//! sessions, which is the farm signal antibot vendors look for first. AdsPower
//! and Dolphin sell a synchroniser; ShardBrowser shipped one in 09.2026 with a
//! design worth copying, and this is that design (docs/08, review of 12.09):
//!
//! **No leader.** Whichever window is receiving your input is the one driving.
//! Every member reports what happens in it; the hub replays it in the others.
//! Switch windows and the roles switch with you.
//!
//! **Each window performs the action itself, with its own motor profile.** A
//! click is not a recording played back: the follower is told "click this
//! element", finds it in its own page, and clicks its own centre — plus a
//! per-window offset of a pixel or two and a per-window delay of 80–400 ms, so
//! no two windows move identically. If the element is not there, the follower
//! falls back to the same viewport coordinates.
//!
//! **Typing is mirrored, but separately switchable.** Every window filling the
//! same form with the same text is exactly what a batch of fresh accounts must
//! not do; the toggle exists so a login on twenty accounts with twenty passwords
//! can be done with typing off and everything else on.
//!
//! ## How it works
//!
//! One CDP connection per member, to the browser endpoint the launch wrote.
//! `Target.setAutoAttach` hands us a session for every page, present and
//! future. In each we install a small listener script in an **isolated world**
//! (`Page.addScriptToEvaluateOnNewDocument` with `worldName`), so the page's own
//! scripts cannot see it, and a binding (`Runtime.addBinding`) it reports
//! through. Reports arrive as `Runtime.bindingCalled`; the hub fans them out
//! as `Input.dispatch*` calls on every other member.
//!
//! An echo guard stops the fan-out from feeding back: a member is muted for
//! half a second after anything is dispatched to it, and reports from a muted
//! member are dropped. The cost is that your own input in a follower window
//! during that half-second is also dropped, which is the right trade.
//!
//! ## What this costs in detectability
//!
//! `Runtime.enable` is measurable (docs/16, 3.5: 2.7× on one code path), which
//! is why profiles launch with `cdp: false` by default. A synchronised group
//! needs it, and says so in the interface: this is the operator choosing the
//! Local API's trade for the duration of the session. Members are launched
//! with CDP when the group starts and keep it until closed.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::tungstenite::Message;

/// What the listener script reports. Kept flat and small: it crosses the
/// binding as a JSON string on every click.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(tag = "t")]
enum PageEvent {
    /// A completed click: viewport coordinates, a selector path to the target,
    /// and the button.
    #[serde(rename = "click")]
    Click { x: f64, y: f64, button: u8, sel: String },
    /// A key press. `text` is the character it would insert, if any.
    #[serde(rename = "key")]
    Key { key: String, code: String, mods: u8, text: String },
    /// A wheel tick at a position.
    #[serde(rename = "wheel")]
    Wheel { x: f64, y: f64, dx: f64, dy: f64 },
}

/// One outgoing CDP command and where its reply goes.
struct Outgoing {
    session: Option<String>,
    method: &'static str,
    params: Value,
    reply: Option<oneshot::Sender<Result<Value, String>>>,
}

/// A member of the group: one browser.
pub struct Member {
    pub profile_id: String,
    pub name: String,
    tx: mpsc::Sender<Outgoing>,
    /// Page sessions attached so far.
    sessions: Vec<String>,
    /// The echo guard.
    muted_until: Instant,
    /// When a click was last dispatched here — a navigation it causes must
    /// not also be broadcast as a navigation.
    last_click: Instant,
    /// This window's motor profile: a fixed offset, a wheel scale, and its
    /// own delay range.
    offset: (f64, f64, f64),
    delay: (u64, u64),
    /// Actions to perform here, in order. One worker per member drains it,
    /// pausing its own delay between actions — so five keystrokes arrive as
    /// five keystrokes in the right order at this window's own cadence, not as
    /// five races. The first version fanned each event out independently and
    /// typed "hello" as "oelhl".
    queue: mpsc::UnboundedSender<(PageEvent, String)>,
    /// The URL its main frame last navigated to, for the navigation echo check.
    url: String,
}

#[derive(Default)]
pub struct Hub {
    members: Mutex<HashMap<String, Member>>,
    pub typing: std::sync::atomic::AtomicBool,
    /// Counters for the status line.
    pub mirrored: std::sync::atomic::AtomicU64,
}

#[derive(serde::Serialize)]
pub struct Status {
    pub active: bool,
    pub typing: bool,
    pub members: Vec<MemberStatus>,
    pub mirrored: u64,
}

#[derive(serde::Serialize)]
pub struct MemberStatus {
    pub profile_id: String,
    pub name: String,
    pub pages: usize,
}

impl Hub {
    pub fn new() -> Arc<Self> {
        let h = Arc::new(Self::default());
        h.typing.store(true, std::sync::atomic::Ordering::Relaxed);
        h
    }

    pub async fn status(&self) -> Status {
        let m = self.members.lock().await;
        Status {
            active: !m.is_empty(),
            typing: self.typing.load(std::sync::atomic::Ordering::Relaxed),
            members: m
                .values()
                .map(|x| MemberStatus { profile_id: x.profile_id.clone(), name: x.name.clone(), pages: x.sessions.len() })
                .collect(),
            mirrored: self.mirrored.load(std::sync::atomic::Ordering::Relaxed),
        }
    }

    /// Add a running browser to the group.
    pub async fn join(self: &Arc<Self>, profile_id: &str, name: &str, ws_endpoint: &str) -> anyhow::Result<()> {
        if !ws_endpoint.starts_with("ws://127.0.0.1:") && !ws_endpoint.starts_with("ws://localhost:") {
            anyhow::bail!("refusing a CDP endpoint that is not loopback: {ws_endpoint}");
        }
        let (socket, _) = tokio_tungstenite::connect_async(ws_endpoint).await?;
        let (tx, rx) = mpsc::channel::<Outgoing>(256);

        // A motor profile: where this hand lands relative to the centre, and
        // how long it takes to get moving. Drawn before the await below — the
        // RNG handle is not Send.
        let (offset, delay, scale) = {
            use rand::Rng;
            let mut rng = rand::thread_rng();
            let lo = rng.gen_range(60..180);
            (
                (rng.gen_range(-3.0..3.0), rng.gen_range(-3.0..3.0)),
                (lo, lo + rng.gen_range(120..300)),
                // How far this hand scrolls for the same flick of the wheel.
                // Two windows at scrollY 161.5 to the half-pixel is a recording,
                // not two people.
                rng.gen_range(0.88..1.12),
            )
        };
        let (queue, mut queue_rx) = mpsc::unbounded_channel::<(PageEvent, String)>();
        let member = Member {
            profile_id: profile_id.to_string(),
            name: name.to_string(),
            tx: tx.clone(),
            sessions: Vec::new(),
            muted_until: Instant::now(),
            last_click: Instant::now() - Duration::from_secs(10),
            offset: (offset.0, offset.1, scale),
            delay,
            queue,
            url: String::new(),
        };
        self.members.lock().await.insert(profile_id.to_string(), member);

        // This member's hand: one action at a time, its own pause before each.
        {
            let hub = Arc::clone(self);
            let pid = profile_id.to_string();
            tokio::spawn(async move {
                while let Some((ev, sid)) = queue_rx.recv().await {
                    let (lo, hi) = match ev {
                        // Keys come faster than clicks: a typist does not pause
                        // a quarter second between letters.
                        PageEvent::Key { .. } => (delay.0 / 2, delay.0 / 2 + 60),
                        _ => delay,
                    };
                    tokio::time::sleep(Duration::from_millis(jitter(lo, hi))).await;
                    // Muted for the action itself and a moment after, so the
                    // events it raises in this page are not reported back.
                    if let Some(m) = hub.members.lock().await.get_mut(&pid) {
                        m.muted_until = Instant::now() + Duration::from_millis(600);
                    }
                    if let Err(e) = hub.replay(&pid, &sid, &ev, (offset.0, offset.1, scale)).await {
                        tracing::debug!(profile = %pid, error = %e, "could not mirror an action");
                    }
                }
            });
        }

        let hub = Arc::clone(self);
        let pid = profile_id.to_string();
        tokio::spawn(async move { hub.pump(pid, socket, rx).await });

        // Every page, present and future.
        self.call(profile_id, None, "Target.setAutoAttach", json!({
            "autoAttach": true, "waitForDebuggerOnStart": false, "flatten": true
        }))
        .await?;
        Ok(())
    }

    /// Remove every member. Their browsers stay open; only the mirroring stops.
    pub async fn stop(&self) {
        let mut m = self.members.lock().await;
        m.clear();
        // Dropping the senders ends each pump.
    }

    pub async fn leave(&self, profile_id: &str) {
        self.members.lock().await.remove(profile_id);
    }

    /// One command to one member, optionally inside a page session.
    async fn call(&self, member: &str, session: Option<&str>, method: &'static str, params: Value) -> anyhow::Result<Value> {
        let tx = {
            let m = self.members.lock().await;
            m.get(member).map(|x| x.tx.clone()).ok_or_else(|| anyhow::anyhow!("{member} is not in the group"))?
        };
        let (reply_tx, reply_rx) = oneshot::channel();
        tx.send(Outgoing { session: session.map(str::to_string), method, params, reply: Some(reply_tx) })
            .await
            .map_err(|_| anyhow::anyhow!("{member}: the CDP connection is gone"))?;
        match tokio::time::timeout(Duration::from_secs(10), reply_rx).await {
            Ok(Ok(Ok(v))) => Ok(v),
            Ok(Ok(Err(e))) => anyhow::bail!("{method}: {e}"),
            Ok(Err(_)) => anyhow::bail!("{method}: no reply"),
            Err(_) => anyhow::bail!("{method}: timed out"),
        }
    }

    /// The socket loop for one member: sends commands, routes replies, turns
    /// events into mirrored actions.
    async fn pump(
        self: Arc<Self>,
        profile_id: String,
        socket: tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
        mut rx: mpsc::Receiver<Outgoing>,
    ) {
        let (mut sink, mut stream) = socket.split();
        let mut next_id: u64 = 1;
        let mut pending: HashMap<u64, oneshot::Sender<Result<Value, String>>> = HashMap::new();

        loop {
            tokio::select! {
                out = rx.recv() => {
                    let Some(out) = out else { break };
                    let id = next_id;
                    next_id += 1;
                    let mut msg = json!({ "id": id, "method": out.method, "params": out.params });
                    if let Some(s) = out.session {
                        msg["sessionId"] = json!(s);
                    }
                    if let Some(r) = out.reply {
                        pending.insert(id, r);
                    }
                    if sink.send(Message::Text(msg.to_string())).await.is_err() {
                        break;
                    }
                }
                frame = stream.next() => {
                    let Some(Ok(frame)) = frame else { break };
                    let Message::Text(text) = frame else { continue };
                    let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
                    if let Some(id) = v.get("id").and_then(|x| x.as_u64()) {
                        if let Some(r) = pending.remove(&id) {
                            let res = match v.get("error") {
                                Some(e) => Err(e.to_string()),
                                None => Ok(v.get("result").cloned().unwrap_or(Value::Null)),
                            };
                            let _ = r.send(res);
                        }
                        continue;
                    }
                    let method = v.get("method").and_then(|m| m.as_str()).unwrap_or_default().to_string();
                    let session = v.get("sessionId").and_then(|s| s.as_str()).map(str::to_string);
                    let params = v.get("params").cloned().unwrap_or(Value::Null);
                    let hub = Arc::clone(&self);
                    let pid = profile_id.clone();
                    tokio::spawn(async move { hub.on_event(&pid, session, &method, params).await });
                }
            }
        }
        self.members.lock().await.remove(&profile_id);
        tracing::info!(profile = %profile_id, "left the synchronised group");
    }

    async fn on_event(&self, member: &str, session: Option<String>, method: &str, params: Value) {
        match method {
            "Target.attachedToTarget" => {
                let Some(sid) = params.get("sessionId").and_then(|s| s.as_str()) else { return };
                let kind = params.pointer("/targetInfo/type").and_then(|t| t.as_str()).unwrap_or("");
                if kind != "page" {
                    return;
                }
                if let Err(e) = self.arm(member, sid).await {
                    tracing::warn!(profile = %member, error = %e, "could not arm a page for mirroring");
                }
            }
            "Target.detachedFromTarget" => {
                if let Some(sid) = params.get("sessionId").and_then(|s| s.as_str()) {
                    if let Some(m) = self.members.lock().await.get_mut(member) {
                        m.sessions.retain(|s| s != sid);
                    }
                }
            }
            "Runtime.bindingCalled" => {
                if params.get("name").and_then(|n| n.as_str()) != Some(BINDING) {
                    return;
                }
                let Some(payload) = params.get("payload").and_then(|p| p.as_str()) else { return };
                let Ok(ev) = serde_json::from_str::<PageEvent>(payload) else { return };
                self.fan_out(member, ev).await;
            }
            "Page.frameNavigated" => {
                // Main frame only.
                if params.pointer("/frame/parentId").is_some() {
                    return;
                }
                let Some(url) = params.pointer("/frame/url").and_then(|u| u.as_str()) else { return };
                if url.starts_with("about:") || url.starts_with("chrome") {
                    return;
                }
                self.on_navigated(member, url).await;
            }
            _ => {}
        }
        let _ = session;
    }

    /// Install the listener in a page and start receiving from it.
    async fn arm(&self, member: &str, sid: &str) -> anyhow::Result<()> {
        self.call(member, Some(sid), "Page.enable", json!({})).await?;
        self.call(member, Some(sid), "Runtime.enable", json!({})).await?;
        self.call(member, Some(sid), "Runtime.addBinding", json!({ "name": BINDING, "executionContextName": WORLD })).await?;
        self.call(member, Some(sid), "Page.addScriptToEvaluateOnNewDocument", json!({
            "source": LISTENER, "worldName": WORLD, "runImmediately": true
        }))
        .await?;
        if let Some(m) = self.members.lock().await.get_mut(member) {
            if !m.sessions.iter().any(|s| s == sid) {
                m.sessions.push(sid.to_string());
            }
        }
        Ok(())
    }

    /// Queue one event for every other member; each performs it in its own
    /// time, in order.
    async fn fan_out(self: &Self, from: &str, ev: PageEvent) {
        if matches!(ev, PageEvent::Key { .. }) && !self.typing.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
        let mut m = self.members.lock().await;
        let Some(src) = m.get(from) else { return };
        if Instant::now() < src.muted_until {
            return; // an echo of something we dispatched
        }
        if let PageEvent::Click { .. } = ev {
            // A click here may navigate here; do not also broadcast that
            // navigation when it lands.
            if let Some(s) = m.get_mut(from) {
                s.last_click = Instant::now();
            }
        }
        let mut n = 0;
        for (id, x) in m.iter_mut() {
            if id.as_str() == from {
                continue;
            }
            let Some(sid) = x.sessions.last().cloned() else { continue };
            // Muted from now: the action is coming, and the guard has to be
            // up before it lands, not after.
            x.muted_until = Instant::now() + Duration::from_millis(1200);
            if let PageEvent::Click { .. } = ev {
                x.last_click = Instant::now();
            }
            if x.queue.send((ev.clone(), sid)).is_ok() {
                n += 1;
            }
        }
        self.mirrored.fetch_add(n, std::sync::atomic::Ordering::Relaxed);
    }

    async fn replay(&self, member: &str, sid: &str, ev: &PageEvent, offset: (f64, f64, f64)) -> anyhow::Result<()> {
        match ev {
            PageEvent::Click { x, y, button, sel } => {
                // The element, in this window's own layout, or the same
                // coordinates when it cannot be found.
                let (cx, cy) = match self.locate(member, sid, sel).await {
                    Some(c) => c,
                    None => (*x, *y),
                };
                let (px, py) = (cx + offset.0, cy + offset.1);
                let btn = match button { 1 => "middle", 2 => "right", _ => "left" };
                self.call(member, Some(sid), "Input.dispatchMouseEvent", json!({
                    "type": "mouseMoved", "x": px, "y": py, "button": "none"
                })).await?;
                self.call(member, Some(sid), "Input.dispatchMouseEvent", json!({
                    "type": "mousePressed", "x": px, "y": py, "button": btn, "clickCount": 1
                })).await?;
                tokio::time::sleep(Duration::from_millis(jitter(40, 110))).await;
                self.call(member, Some(sid), "Input.dispatchMouseEvent", json!({
                    "type": "mouseReleased", "x": px, "y": py, "button": btn, "clickCount": 1
                })).await?;
            }
            PageEvent::Key { key, code, mods, text } => {
                let vk = virtual_key(key);
                let mut down = json!({ "type": if text.is_empty() { "rawKeyDown" } else { "keyDown" }, "key": key, "code": code, "modifiers": mods, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk });
                if !text.is_empty() {
                    down["text"] = json!(text);
                    down["unmodifiedText"] = json!(text);
                }
                self.call(member, Some(sid), "Input.dispatchKeyEvent", down).await?;
                self.call(member, Some(sid), "Input.dispatchKeyEvent", json!({
                    "type": "keyUp", "key": key, "code": code, "modifiers": mods, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk
                })).await?;
            }
            PageEvent::Wheel { x, y, dx, dy } => {
                self.call(member, Some(sid), "Input.dispatchMouseEvent", json!({
                    "type": "mouseWheel", "x": x + offset.0, "y": y + offset.1,
                    "deltaX": dx * offset.2, "deltaY": dy * offset.2
                })).await?;
            }
        }
        Ok(())
    }

    /// The centre of the element a selector names, in this page's own layout.
    async fn locate(&self, member: &str, sid: &str, sel: &str) -> Option<(f64, f64)> {
        if sel.is_empty() {
            return None;
        }
        let doc = self.call(member, Some(sid), "DOM.getDocument", json!({ "depth": 0 })).await.ok()?;
        let root = doc.pointer("/root/nodeId")?.as_u64()?;
        let node = self.call(member, Some(sid), "DOM.querySelector", json!({ "nodeId": root, "selector": sel })).await.ok()?;
        let node_id = node.get("nodeId")?.as_u64()?;
        if node_id == 0 {
            return None;
        }
        let box_model = self.call(member, Some(sid), "DOM.getBoxModel", json!({ "nodeId": node_id })).await.ok()?;
        let quad = box_model.pointer("/model/content")?.as_array()?;
        let xs: Vec<f64> = quad.iter().step_by(2).filter_map(|v| v.as_f64()).collect();
        let ys: Vec<f64> = quad.iter().skip(1).step_by(2).filter_map(|v| v.as_f64()).collect();
        if xs.len() < 4 || ys.len() < 4 {
            return None;
        }
        Some((xs.iter().sum::<f64>() / 4.0, ys.iter().sum::<f64>() / 4.0))
    }

    /// A navigation in one member that no mirrored click explains is an
    /// address-bar navigation, and every other member follows.
    async fn on_navigated(&self, from: &str, url: &str) {
        let targets: Vec<(String, String)> = {
            let mut m = self.members.lock().await;
            let Some(src) = m.get_mut(from) else { return };
            let same = src.url == url;
            src.url = url.to_string();
            if same || Instant::now() < src.muted_until || src.last_click.elapsed() < Duration::from_secs(4) {
                return;
            }
            m.iter_mut()
                .filter(|(id, x)| id.as_str() != from && x.url != url)
                .filter_map(|(id, x)| {
                    let sid = x.sessions.last()?.clone();
                    x.muted_until = Instant::now() + Duration::from_millis(1500);
                    x.url = url.to_string();
                    Some((id.clone(), sid))
                })
                .collect()
        };
        for (id, sid) in targets {
            tokio::time::sleep(Duration::from_millis(jitter(150, 900))).await;
            let _ = self.call(&id, Some(&sid), "Page.navigate", json!({ "url": url })).await;
        }
    }
}

/// A delay in `lo..=hi` ms. A function rather than an inline `thread_rng()` so
/// no RNG handle is alive across an await — the handle is not `Send`.
fn jitter(lo: u64, hi: u64) -> u64 {
    use rand::Rng;
    rand::thread_rng().gen_range(lo..=hi)
}

const BINDING: &str = "__furyMirror";
const WORLD: &str = "fury-mirror";

/// Installed in an isolated world in every page of every member. Reports
/// clicks, keys and wheel ticks through the binding; nothing it does is visible
/// to the page's own scripts, and it adds no globals to the main world.
///
/// The selector path is built from ids and tag positions only — class names
/// change between sessions on the sites this is used on, ids and structure
/// less so.
const LISTENER: &str = r#"
(() => {
  if (window.__furyArmed) return; window.__furyArmed = true;
  const send = (o) => { try { window.__furyMirror(JSON.stringify(o)); } catch (e) {} };
  const path = (el) => {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 8) {
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) { parts.unshift('#' + el.id); break; }
      let i = 1, s = el;
      while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) i++;
      parts.unshift(el.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
      el = el.parentElement;
    }
    return parts.join('>');
  };
  const mods = (e) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
  addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    send({ t: 'click', x: e.clientX, y: e.clientY, button: e.button, sel: path(e.target) });
  }, true);
  addEventListener('keydown', (e) => {
    if (!e.isTrusted) return;
    const text = e.key.length === 1 && !e.ctrlKey && !e.metaKey ? e.key : '';
    send({ t: 'key', key: e.key, code: e.code, mods: mods(e), text });
  }, true);
  let wheelAt = 0, acc = { dx: 0, dy: 0, x: 0, y: 0 };
  addEventListener('wheel', (e) => {
    if (!e.isTrusted) return;
    acc.dx += e.deltaX; acc.dy += e.deltaY; acc.x = e.clientX; acc.y = e.clientY;
    const now = Date.now();
    if (now - wheelAt > 120) {
      wheelAt = now;
      send({ t: 'wheel', x: acc.x, y: acc.y, dx: acc.dx, dy: acc.dy });
      acc.dx = 0; acc.dy = 0;
    }
  }, { capture: true, passive: true });
})();
"#;

/// Windows virtual-key codes for the keys a page cares about. Printable
/// characters carry their text and need no code; everything else does, or
/// Chromium ignores the event.
fn virtual_key(key: &str) -> u32 {
    match key {
        "Enter" => 13,
        "Tab" => 9,
        "Backspace" => 8,
        "Delete" => 46,
        "Escape" => 27,
        " " => 32,
        "ArrowLeft" => 37,
        "ArrowUp" => 38,
        "ArrowRight" => 39,
        "ArrowDown" => 40,
        "Home" => 36,
        "End" => 35,
        "PageUp" => 33,
        "PageDown" => 34,
        "Shift" => 16,
        "Control" => 17,
        "Alt" => 18,
        "Meta" => 91,
        k if k.len() == 1 => k.to_ascii_uppercase().chars().next().map(|c| c as u32).unwrap_or(0),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_events_round_trip_the_wire_shape() {
        let e: PageEvent = serde_json::from_str(r##"{"t":"click","x":10.5,"y":20,"button":0,"sel":"#login>button:nth-of-type(1)"}"##).unwrap();
        assert!(matches!(e, PageEvent::Click { button: 0, .. }));
        let k: PageEvent = serde_json::from_str(r#"{"t":"key","key":"a","code":"KeyA","mods":0,"text":"a"}"#).unwrap();
        assert!(matches!(k, PageEvent::Key { .. }));
        let w: PageEvent = serde_json::from_str(r#"{"t":"wheel","x":1,"y":2,"dx":0,"dy":120}"#).unwrap();
        assert!(matches!(w, PageEvent::Wheel { dy, .. } if dy == 120.0));
    }

    #[test]
    fn special_keys_have_codes_and_letters_have_theirs() {
        assert_eq!(virtual_key("Enter"), 13);
        assert_eq!(virtual_key("a"), 65);
        assert_eq!(virtual_key("F13"), 0);
    }

    #[tokio::test]
    async fn an_empty_hub_is_inactive() {
        let h = Hub::new();
        let s = h.status().await;
        assert!(!s.active);
        assert!(s.typing);
    }
}
