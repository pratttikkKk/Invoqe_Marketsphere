# MarketSphere: Production Deployment & Operations Guide

## 1. Prerequisites
- **Node.js**: >= 18.0.0 (LTS recommended)
- **MongoDB**: >= 6.0.0 (MongoDB Atlas with TLS recommended for production)
- **Docker**: Optional, for containerized deployments

---

## 2. Environment Variables Specification

### Backend (`backend/.env`)
| Variable | Description | Required in Production | Example / Default |
| :--- | :--- | :---: | :--- |
| `NODE_ENV` | Runtime environment | Yes | `production` |
| `PORT` | HTTP port to bind | Yes | `5002` (or provider assigned) |
| `MONGO_URI` | MongoDB Atlas Connection String | Yes | `mongodb+srv://user:pass@cluster.mongodb.net/marketsphere?retryWrites=true&w=majority` |
| `JWT_SECRET` | Strong cryptographic secret for auth | Yes | `min-32-char-random-cryptographic-secret` |
| `CLIENT_URL` | Allowed frontend origin for CORS | Yes | `https://marketsphere.example.com` |
| `PAYMENT_PROVIDER`| Payment gateway provider | Yes | `RAZORPAY` |
| `RAZORPAY_KEY_ID` | Razorpay Merchant Public Key | Yes | `rzp_live_xxxxxxxxxxxxxxxx` |
| `RAZORPAY_KEY_SECRET` | Razorpay Merchant Secret Key | Yes | `yyyyyyyyyyyyyyyyyyyyyyyy` |
| `RAZORPAY_WEBHOOK_SECRET` | Secret configured on Razorpay Webhook dashboard | Yes | `zzzzzzzzzzzzzzzzzzzzzzzz` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary persistent object storage | Optional (Fallback to local) | `marketsphere-prod` |
| `CLOUDINARY_API_KEY` | Cloudinary API Key | Optional | `123456789012345` |
| `CLOUDINARY_API_SECRET` | Cloudinary API Secret | Optional | `secret_key` |
| `EMAIL_PROVIDER` | Transactional email provider (`resend`, `brevo`, `console`) | Yes (in Prod) | `resend` (or `brevo`) |
| `EMAIL_FROM` | Sender display name & email address | Yes (in Prod) | `MarketSphere <onboarding@resend.dev>` |
| `RESEND_API_KEY` | Resend API key (if `EMAIL_PROVIDER=resend`) | Conditional | `re_xxxxxxxxxxxxxxxxxxxx` |
| `BREVO_API_KEY` | Brevo API key (if `EMAIL_PROVIDER=brevo`) | Conditional | `xkeysib-xxxxxxxxxxxxxxxx` |
| `BREVO_SENDER_EMAIL` | Verified sender email in Brevo (no domain required) | Conditional | `your_verified@gmail.com` |

### Frontend (`frontend/.env`)
| Variable | Description | Required in Production | Example / Default |
| :--- | :--- | :---: | :--- |
| `VITE_API_URL` | Backend API base URL | Yes | `https://api.marketsphere.example.com/api/v1` |

---

## 3. Step-by-Step Deployment Procedure

### Step 3.1: Database Setup
1. Provision a MongoDB Atlas cluster (M0 sandbox for staging or M10+ for production).
2. Create a dedicated database user with readWrite privileges on `marketsphere`.
3. Whitelist the IP addresses of your backend servers (or allow access from anywhere `0.0.0.0/0` with strong authentication).

### Step 3.2: Bootstrap Administrator Account
Execute the direct CLI bootstrap tool in a secure shell:
```bash
cd backend
ADMIN_EMAIL="admin@yourdomain.com" ADMIN_PASSWORD="YourStrongPassword2026!" npm run bootstrap:admin
```
> [!NOTE]
> The admin bootstrap runs strictly via local CLI directly into MongoDB. There is NO public HTTP admin registration endpoint.

### Step 3.3: Deploy Backend (Render / Railway / AWS ECS)
1. Set the build command:
   ```bash
   npm ci
   ```
2. Set the start command:
   ```bash
   node server.js
   ```
3. Configure all required backend environment variables.
4. Set health check probe to:
   - **Liveness:** `GET /api/v1/health`
   - **Readiness:** `GET /api/v1/ready`

### Step 3.4: Deploy Frontend (Vercel / Netlify / Cloudflare Pages)
1. Set framework to **Vite**.
2. Root directory: `frontend`.
3. Build command:
   ```bash
   npm ci && npm run build
   ```
4. Output directory: `dist`.
5. Configure `VITE_API_URL` to point to your deployed backend.
6. Configure SPA fallback rewrite in `vercel.json`:
   ```json
   {
     "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
   }
   ```

### Step 3.5: Razorpay Webhook Configuration
1. Open Razorpay Merchant Dashboard -> Settings -> Webhooks.
2. Click **Add New Webhook**.
3. **Webhook URL**: `https://api.yourdomain.com/api/v1/payments/webhook`.
4. **Secret**: Enter the value used in `RAZORPAY_WEBHOOK_SECRET`.
5. **Active Events**: Check:
   - `payment.captured`
   - `payment.failed`
   - `refund.processed`
   - `refund.failed`
6. Click **Create Webhook**.

### Step 3.6: Configure Production Transactional Email (HTTPS API)

> [!IMPORTANT]
> **Why Render Blocks Nodemailer/Gmail SMTP:**
> Cloud platforms (Render Free Tier, AWS EC2, GCP, Railway) intentionally block outbound TCP traffic on ports **25, 465, and 587** to prevent spam.
> Standard Nodemailer/Gmail SMTP attempts will hang until socket timeout (`ETIMEDOUT`). MarketSphere solves this permanently by delivering emails over **outbound HTTPS (Port 443)** using either Resend or Brevo.

Choose **Option A** (Resend) or **Option B** (Brevo):

#### Option A: Resend (https://resend.com) - Preferred with Custom Domain
1. Sign up for a free account at [Resend.com](https://resend.com) (Free tier: 3,000 emails/mo, 100/day).
2. Go to **API Keys** -> Create an API key -> Copy key starting with `re_`.
3. In **Render Dashboard** -> Your Web Service -> **Environment**:
   - `EMAIL_PROVIDER`: `resend`
   - `RESEND_API_KEY`: `re_your_api_key_here`
   - `EMAIL_FROM`: `MarketSphere <onboarding@resend.dev>` (for testing with your account owner email) or `MarketSphere <auth@yourdomain.com>` (for production).
4. **Recipient Limitation Notice:**
   - The default `onboarding@resend.dev` sender identity **only delivers to your Resend account owner email address**.
   - To send registration OTPs to *any* customer's Gmail inbox, you must verify your custom domain in Resend (**Domains** -> **Add Domain** -> Add the provided DNS TXT/MX records to Cloudflare, GoDaddy, or your DNS host).

#### Option B: Brevo (https://brevo.com) - Free Delivery to ANY Gmail WITHOUT Custom Domain
1. Sign up for a free account at [Brevo.com](https://brevo.com) (Free tier: 300 emails/day, 9,000/mo).
2. Go to **Senders, Domains & Dedicated IPs** -> **Senders** -> **Add a Sender**:
   - Add your existing personal Gmail address (e.g. `yourname@gmail.com`).
   - Brevo will send a confirmation link to that address. Click the link to verify.
3. Go to **SMTP & API** -> **API Keys** -> **Generate a new API key**.
4. In **Render Dashboard** -> Your Web Service -> **Environment**:
   - `EMAIL_PROVIDER`: `brevo`
   - `BREVO_API_KEY`: `xkeysib-your_brevo_api_key_here`
   - `EMAIL_FROM`: `MarketSphere <yourname@gmail.com>`
   - `BREVO_SENDER_EMAIL`: `yourname@gmail.com`
5. *Result:* Your application can now send real registration OTP emails to any Gmail address worldwide over HTTPS, without paying for a domain or Render upgrade.

#### Step 3.7: Live Verification of Email Relay
Once deployed on Render, verify your live email relay in 5 seconds by visiting:
```
GET https://<your-render-app>.onrender.com/api/v1/auth/test-email-status?to=your_real_inbox@gmail.com
```
This returns the active provider configuration status and dispatches a test confirmation email to your real inbox.

---

## 4. Docker Deployment

### Building and Running the Backend Container
```bash
cd backend
docker build -t marketsphere-backend:latest .
docker run -d \
  -p 5002:5002 \
  --env-file .env \
  --name marketsphere-api \
  marketsphere-backend:latest
```

### Full Stack Local Development with Docker Compose
```bash
docker-compose up --build
```
This runs MongoDB, Backend API, and Seed scripts in an orchestrated local environment.
