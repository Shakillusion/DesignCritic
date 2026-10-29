# Deploying DesignCritic AI for free (Oracle Cloud Always Free)

DesignCritic needs a server that keeps files on disk (SQLite + uploads), can run a headless Chromium (rendering, export, QA) and stays up for long background jobs. Serverless hosts such as Vercel or Netlify can't do that. An Oracle Cloud **Always Free** Ampere VM can, at no cost.

What you end up with: `https://<your-ip>.sslip.io` (free HTTPS, no domain to buy), protected by a password, rebuilt from this GitHub repo with one command.

## 1. Create the free VM (about 10 minutes, in the browser)

1. Sign up at <https://signup.cloud.oracle.com>. Oracle asks for a card to verify identity; Always Free resources are not charged. Pick a **home region** near you; free VMs can only be created there.
2. Console → **Compute → Instances → Create instance**.
   - **Image:** Canonical Ubuntu 24.04.
   - **Shape:** *Change shape* → **Ampere** → `VM.Standard.A1.Flex`, **2 OCPUs, 12 GB memory** (free limit is 4 OCPUs / 24 GB in total).
   - **Networking:** keep the defaults and make sure **Assign a public IPv4 address** is on.
   - **SSH keys:** *Generate a key pair for me* → **download the private key** (you need it to log in).
   - Create. If you see *Out of capacity*, try another availability domain or try again later; it's common for free Ampere VMs.
3. Open the web ports in Oracle's network firewall: Instance page → **Subnet** link → **Security Lists** → *Default Security List* → **Add Ingress Rules**:
   - Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port `80`
   - Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port `443`
4. Copy the instance's **Public IP address**.

## 2. Log in to the VM

On Windows, in PowerShell (replace the key path and IP):

```powershell
ssh -i C:\path\to\ssh-key.key ubuntu@YOUR.PUBLIC.IP
```

If Windows complains the key is "too open": right-click the key file → Properties → Security → Advanced → Disable inheritance → remove everyone except your user.

## 3. Install and start the app (on the VM)

```bash
git clone https://github.com/Shakillusion/DesignCritic.git
cd DesignCritic
bash deploy/oracle-setup.sh
```

The repo must be public for this plain clone. If it's private, create a GitHub personal access token (read-only *Contents* on this repo) and clone with `git clone https://<token>@github.com/Shakillusion/DesignCritic.git`.

The script:

- installs Docker
- opens ports 80/443 in the VM's own firewall
- asks for an **access password** and your free AI keys. Typing is hidden; they're saved only in `.env` on the VM with owner-only permissions.
- builds the image, about 5–10 minutes the first time
- starts the app behind Caddy, which gets a free HTTPS certificate automatically

Then open `https://<your-ip-with-dashes>.sslip.io` (the script prints it) and sign in.

## Updating after you push new code

```bash
cd ~/DesignCritic && bash deploy/update.sh
```

Your projects, uploads and settings live in the Docker volume `designcritic-data` and survive updates and restarts.

## Everyday commands (on the VM)

| What | Command |
|---|---|
| See logs | `sudo docker compose logs -f app` |
| Restart | `sudo docker compose restart app` |
| Change a key or the password | `nano .env`, then `sudo docker compose up -d` |
| Back up your data | `sudo docker run --rm -v designcritic_designcritic-data:/data -v ~/:/backup busybox tar czf /backup/designcritic-backup.tgz -C /data .` |

Changing `DESIGNCRITIC_PASSWORD` signs out every browser.

## Using your own domain later

Point an `A` record at the VM's IP, set `DOMAIN=yourdomain.com` in `.env`, and run `sudo docker compose up -d`. Caddy issues the certificate on its own.

## Running the image elsewhere

The `Dockerfile` works on any Docker host with a persistent volume: mount it at `/data`, set the same environment variables, and expose port 3000 behind HTTPS. Hosts whose disk is wiped on restart, such as free Render or Hugging Face Spaces, will lose your data.
