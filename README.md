# ⚔️ StateWars

A State.io-style territory conquest game that runs in the browser. Play with up to 4 people (plus bots) on maps of Italy, Uzbekistan, Russia, Germany and Japan.

## Put it on GitHub (free hosting)

1. Create a new GitHub repository (e.g. `statewars`).
2. Upload all files: `index.html`, `style.css`, `maps.js`, `game.js`, `README.md`.
3. Go to **Settings → Pages**, set **Source: Deploy from a branch**, branch `main`, folder `/ (root)`, and Save.
4. After about a minute your game is live at `https://YOUR-USERNAME.github.io/statewars/`.

## Play with friends

1. Open the game, tap **Create room**.
2. Pick a map, then tap **Share link** and send it to your friends (or give them the 5-letter code).
3. Everyone opens the link and taps **Join**. The host taps **Start game**.

## Controls

- Drag from one of your cities to any other city to send troops.
- Or tap your cities (you can select several), then tap the target.
- The **Send** button switches between sending 100% and 50% of the troops.

## Rules

- Bigger cities produce troops faster and hold more.
- Troops of different players that meet on the way fight each other.
- Last player alive wins.

## Notes

- Online play is peer-to-peer (WebRTC via PeerJS). The host's browser runs the game, so the host must keep the tab open and in the foreground.
- If a friend cannot connect (strict mobile networks or firewalls), try Wi-Fi or another network. A TURN server can be added in `game.js` (`new Peer(..., { config: { iceServers: [...] } })`).
- If a player disconnects mid-game, a bot takes over their cities.
- To add a map, add an entry to `maps.js` with real lon/lat outline points and cities.
