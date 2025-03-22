# Multiplayer Browser Game with WebSocket

This is a multiplayer browser-based game using Phaser and WebSockets for real-time communication.

## Deployment Guide

### Important Note About WebSockets on Netlify

Netlify Functions are serverless functions that run in a stateless environment. They don't support long-lived connections like WebSockets natively. For a multiplayer game, you need to deploy a separate WebSocket server.

### Deployment Steps

1. **Deploy the WebSocket Server**:
   
   The `server.js` file contains the WebSocket server implementation. Deploy this to a service that supports long-running processes, such as:
   
   - Heroku
   - Railway
   - Render
   - DigitalOcean
   - AWS EC2

   Example deployment on Heroku:
   ```bash
   # Install Heroku CLI if you haven't already
   npm install -g heroku

   # Login to Heroku
   heroku login

   # Create a new Heroku app
   heroku create

   # Deploy to Heroku
   git push heroku main
   ```
   
   **Railway Deployment Instructions:**
   
   1. Sign up for a Railway account at [railway.app](https://railway.app/)
   
   2. Install the Railway CLI:
      ```bash
      npm i -g @railway/cli
      ```
   
   3. Login to Railway from your terminal:
      ```bash
      railway login
      ```
   
   4. Initialize a new Railway project in your repository:
      ```bash
      railway init
      ```
   
   5. Create a new service for your WebSocket server:
      ```bash
      railway add
      ```
      
      Select "Empty Service" when prompted for a template.
   
   6. Deploy your WebSocket server:
      ```bash
      railway up
      ```
   
   7. Get your service URL:
      ```bash
      railway domain
      ```
      
      This will give you the URL to your deployed service. Note that Railway automatically assigns HTTPS, so your WebSocket URL will start with `wss://`.
   
   8. You can also deploy by connecting your GitHub repository:
      - Go to [railway.app](https://railway.app/) dashboard
      - Click "New Project" → "Deploy from GitHub repo"
      - Select your repository and branch
      - Railway will automatically deploy your server
   
   9. Configure environment variables (if needed):
      - Go to your project in the Railway dashboard
      - Click on your service
      - Click on the "Variables" tab
      - Add any environment variables your app needs
      
      **Required Environment Variable for Cloudflare Turnstile:**
      - `TURNSTILE_SECRET_KEY`: Your Cloudflare Turnstile secret key

2. **Update WebSocket Connection URL**:
   
   In `public/js/game.js`, update the WebSocket connection URL to point to your deployed server:
   
   ```javascript
   // Change this line in connectWebSocket function:
   wsUrl = 'wss://your-project-name.railway.app'; // Update with your Railway app URL
   ```

3. **Deploy the Frontend to Netlify**:
   
   - Create a Netlify account if you don't have one
   - Connect your repository to Netlify
   - Set the build command (if needed) and publish directory to `public`
   - Deploy the site

## Cloudflare Turnstile Integration

This game uses Cloudflare Turnstile to protect the login screen with a CAPTCHA. To configure:

1. The site key `0x4AAAAAABCEsgftQ0R1Rv3F` is already set in the frontend code.

2. Set up your secret key:
   - Set the `TURNSTILE_SECRET_KEY` environment variable on your Railway deployment
   - This key is used by the server to verify CAPTCHA responses
   - **⚠️ IMPORTANT:** The secret key must be kept private and should ONLY be set on the server

3. If you need to use your own Turnstile keys:
   - Register at [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/)
   - Create a new site and get your site key and secret key
   - Update the site key in `game.js` in the `showLoginScreen()` function
   - Update the secret key in your Railway environment variables

### Testing Turnstile Locally

When running locally, the application will automatically bypass Turnstile verification in development mode:

1. Run the server in development mode:
   ```bash
   npm run dev
   ```
   
2. The console will show a message indicating that Turnstile verification is being bypassed.

3. You can also access a test page at `/turnstile-test.html` to verify your Turnstile integration.

### Troubleshooting Turnstile

If you're experiencing issues with Turnstile verification:

1. Check server logs for verification errors
2. Verify your secret key is correctly set in the environment variables
3. Make sure the site key in the frontend code matches your Cloudflare Turnstile site key
4. Test using the `/turnstile-test.html` page to isolate the issue
5. Common errors:
   - `missing-input-secret`: The secret key is missing
   - `invalid-input-secret`: The secret key is invalid
   - `timeout-or-duplicate`: The token has timed out or is a duplicate
   - `sitekey-secret-mismatch`: The site key and secret key do not match

## Local Development

To run the game locally:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the WebSocket server:
   ```bash
   npm run dev
   ```

3. Open your browser to http://localhost:3000

## Game Controls

- WASD or arrow keys to move
- Click to shoot
- Mobile controls will appear automatically on touch devices

## Troubleshooting

- If WebSocket connections are failing, check:
  - CORS settings on your WebSocket server
  - SSL/TLS certificates (wss:// requires valid SSL)
  - Network/firewall restrictions

- Common errors:
  - "Cannot set properties of null" - Usually related to WebSocket initialization
  - "WebSocket connection failed" - Check the server URL and ensure the server is running

## License

This project is licensed under the MIT License - see the LICENSE file for details. 