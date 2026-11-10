# DweetLive Gift Listener

Node.js service for public TikTok LIVE events from @dweetlive, with a printer display.

## Features
- Gifts, gift streaks, likes, follows, shares, chat, joins and subscriptions
- VIP classification by diamond threshold
- Authenticated WebSocket event feed
- Health and status endpoints
- Automatic reconnect attempts

## Deploy on Render
1. Put the full project folder in a GitHub repository.
2. In Render, create a Web Service and connect the repository.
3. Use `npm install` as build command and `npm start` as start command.
4. Set environment variables:
   - `DWEETLIVE_USERNAME=dweetlive`
   - `DWEETLIVE_ACCESS_TOKEN` to a long random secret
   - `VIP_DIAMONDS=100`
   - `RECONNECT_MS=15000`
5. Deploy.

Never publish the access token in GitHub or screenshots.

## Printer display
After deployment, open the service URL in Safari, paste the same access token into the printer screen and tap Connect.

Endpoints: `/health`, `/status`, `/config`. WebSocket: `/live`.

## Local run
Requires Node.js 20+.
Run `npm install`, copy `.env.example` to `.env`, set a long random access token, then run `npm start`.

## Limitations
Uses the unofficial reverse-engineered `tiktok-live-connector` library. TikTok may change its protocol and event availability is not guaranteed. Render free hosting can sleep or restart and is not guaranteed 24/7.
