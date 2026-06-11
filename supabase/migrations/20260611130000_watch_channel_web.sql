-- In-app watchlists: users "save" services keyed by their FingerprintJS
-- visitor id (no account needed). channel='web', target=visitor id.
-- (Replaces the Telegram alert channel for now; email may come later.)

alter type watch_channel add value if not exists 'web';
