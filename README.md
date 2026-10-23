# ShareKita — Nearby File Transfer (MVP)

Privacy-first file sharing for classrooms and labs. No cloud, no account.

## How it works
1. **Sender** picks files → app starts a TCP server on the local Wi-Fi IP (port 8899) and shows a QR code `{ip, port, token}`.
2. **Receiver** scans the QR → connects, authenticates with the one-time token, and receives the file manifest.
3. Receiver requests files one by one: `get {id, offset}`. Partial files are saved as `name.size.part`, so after a dropped connection a re-scan **resumes** from the saved offset.
4. Progress, speed, and history (AsyncStorage) are tracked in a Zustand store.

## Run
Uses native modules (`react-native-tcp-socket`, `react-native-fs`), so **Expo Go will not work** — use a dev build:

```bash
npm install
npx expo install expo-status-bar
npx expo prebuild
npx expo run:android     # or run:ios (needs macOS)
```

## Limits & next steps
- Both devices must be on the same Wi-Fi (or one's hotspot). Client/AP isolation on campus Wi-Fi will block it.
- iOS prompts for Local Network permission on first connection.
- Transfers pause when the app is backgrounded (OS limit); resume by re-scanning.
- Plain TCP: the token authenticates the session, but data is unencrypted. Next: encrypt chunks (e.g. libsodium secretbox with a key carried in the QR).
- Next: mDNS discovery, SHA-256 verification per file, "send to many" mode for classrooms, share-sheet integration.
