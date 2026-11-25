# Run Auto Job online (Oracle Cloud, free)

This puts everything on a free server in Oracle's data center: n8n, the 9:00 daily run, the reply watcher, Claude, the PDFs, your job library and tracker. Your own PC can stay off. You open the dashboard from your phone or any browser.

It costs nothing: Oracle's **Always Free** server, free HTTPS, your existing Claude subscription, and Apify's free monthly credit.

Everything below happens in a web browser. You never install anything on your PC.

## Part 1. Oracle account (10 minutes)

1. Go to https://www.oracle.com/cloud/free/ and click **Start for free**.
2. **Home region:** pick one close to you, for example *India West (Mumbai)* or *UAE East (Dubai)*. You can't change it later, and the free server must be in this region.
3. Oracle asks for a card to check your identity. Always Free resources are never charged.

## Part 2. Create the server (5 minutes, then 15 minutes of automatic install)

In the Oracle console: **☰ → Compute → Instances → Create instance**.

| Setting | Choose |
|---|---|
| Name | `auto-job` |
| Image | **Change image → Canonical Ubuntu → 24.04** |
| Shape | **Change shape → Ampere → VM.Standard.A1.Flex**, 2 OCPUs, 12 GB memory (the free limit is 4 OCPUs and 24 GB) |
| Networking | keep the defaults; **Automatically assign public IPv4 address** must be on |
| SSH keys | **Generate a key pair for me → Save private key**. Keep this file: it is how you sign in to the server |
| Advanced options → Management | **Paste cloud-init script**, then paste the whole of [`server/cloud-init.sh`](server/cloud-init.sh) |

Click **Create**. When it says *Running*, copy the **Public IP address** from the instance page.

If Oracle says **Out of capacity** for the Ampere shape, try another *Availability domain* on the same page, or try again later (free Ampere servers are popular). The small **VM.Standard.E2.1.Micro** shape also works, but it is slow.

**Open the web ports:** on the instance page, click the **Subnet** link → **Security Lists** (or **Security** tab) → **Default Security List** → **Add Ingress Rules**:
- Source CIDR `0.0.0.0/0`, IP Protocol TCP, Destination port range `80`
- Add another rule the same way with port `443`

## Part 3. Finish the install (5 minutes)

1. In the Oracle console, click the **Cloud Shell** icon (`>_`, top right). A terminal opens in your browser.
2. In Cloud Shell's menu (⚙ or ☰) choose **Upload** and upload the private key file you saved.
3. Sign in to your server (put your IP and the key's file name in):
   ```
   chmod 600 ssh-key-*.key
   ssh -i ssh-key-*.key ubuntu@YOUR.IP.ADDRESS
   ```
   Type `yes` the first time.
4. Wait for the automatic install to finish. This shows its progress. Press Ctrl+C when you see `== Done`:
   ```
   tail -f /var/log/autojob-install.log
   ```
5. Run the setup:
   ```
   autojob-setup
   ```
   It asks for your name, email, phone, LinkedIn and job titles. It then asks for a **web password**, which protects the dashboard and n8n (the user name is `autojob`). Last, it signs Claude in with your subscription: it shows a link, you open it, sign in, and paste the code and then the token back.

At the end it prints your two addresses:
- Dashboard: `https://YOUR-IP.sslip.io`
- n8n: `https://n8n.YOUR-IP.sslip.io`

## Part 4. n8n account and credentials (15 minutes)

1. Open the n8n address, sign in with `autojob` and your password, and create your n8n owner account.
2. **Credentials → Add**, with these exact names:

| Name | Type | What to enter |
|---|---|---|
| **Apify API** | Header Auth | Name `Authorization`, Value `Bearer <your Apify token>` (Apify Console → Settings → API & Integrations) |
| **Gmail account** | Gmail OAuth2 API | Google Cloud OAuth client (below) |
| **Google Calendar account** | Google Calendar OAuth2 API | the same OAuth client |

3. **Google OAuth client** at https://console.cloud.google.com:
   1. Create a project, then enable the **Gmail API** and the **Google Calendar API**.
   2. OAuth consent screen: External, and add your Gmail as a **Test user**.
   3. Credentials → Create OAuth client ID → *Web application*. Authorized redirect URI:
      `https://n8n.YOUR-IP.sslip.io/rest/oauth2-credential/callback`
   4. Paste the Client ID and Secret into both n8n credentials and click **Sign in with Google**.
4. Back in Cloud Shell (sign in again with step 3 of Part 3 if it closed), link the workflows to the credentials:
   ```
   autojob-update
   ```

## Part 5. Start applying

Open the dashboard address and sign in with `autojob` and your password.

1. **Master resume:** upload your resume (.docx or .pdf) and check the converted version.
2. **Settings:** set **Applications a day** to `1` for your first runs, and read what goes out.
3. Click **Apply now** once to test it.
4. Switch on **Apply every day at 9:00** and **Watch replies**.

## Good to know

- **The LinkedIn feed check is off online.** It needs Chrome on your own PC. All the other job sources work.
- **Google sign-in expires about once a week** while your Google OAuth app is in Testing mode. When sending fails, open n8n → Credentials → Gmail account → **Sign in with Google** again (same for Calendar).
- **Oracle can reclaim Always Free servers that sit idle** for 7 days (very low CPU, network and memory use). Auto Job works every day, but if Oracle emails you about an idle instance, you can upgrade the account to *Pay As You Go*. Always Free servers stay free on it, and reclaiming stops. Set a budget alert of $1 if you do.
- **Your data lives only on the server** (in `/home/ubuntu/auto-job`). To keep a copy, download it now and then from Cloud Shell: `scp -i ssh-key-*.key -r ubuntu@YOUR.IP.ADDRESS:auto-job/tracker .` and then Cloud Shell's **Download**.
- **Updates:** after the code on GitHub changes, run `autojob-update` on the server.
- **Problems:** see what a service says with
  ```
  journalctl --user -u autojob-n8n -n 100
  journalctl --user -u autojob-dashboard -n 100
  ```
  and run logs are in `~/auto-job/logs/`.
