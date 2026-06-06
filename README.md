# Fadi Animation Review

A static web dashboard to rate, trash, and comment on the 100 Fadi overlay
animations (built with the `fadishoot-overlays` kit + a Claude agent swarm).

- **Grid** + **Focus** (one-at-a-time) views; every clip loops.
- 5-star ratings, 🗑 trash, per-item comments.
- Auto-hides what you've reviewed (default "To review" filter).
- Filter by stars / category / commented, sort, search.
- **Ratings persist in your browser** (localStorage). Use **⬇ Export** to download
  `ratings.json` and **⬆ Import** to load one — hand the JSON back to Claude to
  prune the trashed/low-star ones and apply your comments.

Pure static site (HTML + 100 small mp4 clips). Deployed on Vercel.

Focus-view keys: `1`–`5` rate · `0` clear · `T` trash · `←/→` navigate (rating/trashing auto-advances).
