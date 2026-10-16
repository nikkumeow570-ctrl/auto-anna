#!/usr/bin/env bash
# Run ONCE. Makes the key that signs every Auto Anna release, and stores it in your GitHub repository secrets.
# Needs: pkg install openjdk-17 gh -y   and   gh auth login   (you already did the login).
#   cd ~/auto-anna && bash android/make-keystore.sh
set -euo pipefail
command -v keytool >/dev/null || { echo "Install Java first:  pkg install openjdk-17 -y"; exit 1; }
command -v gh >/dev/null || { echo "Install GitHub CLI first:  pkg install gh -y"; exit 1; }
KS="$HOME/auto-anna-release.jks"; INFO="$HOME/.auto-anna-keystore"
if [ -f "$KS" ]; then echo "$KS already exists. Not touching it."; else
  PASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  keytool -genkeypair -v -keystore "$KS" -alias autoanna -keyalg RSA -keysize 4096 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" -dname "CN=Auto Anna, O=Auto Anna, C=IN" >/dev/null 2>&1
  ( umask 077; printf 'KEYSTORE=%s\nALIAS=autoanna\nPASSWORD=%s\n' "$KS" "$PASS" > "$INFO" )
  echo "Key created: $KS"
fi
PASS="$(grep '^PASSWORD=' "$INFO" | cut -d= -f2-)"
base64 -w0 "$KS" | gh secret set KEYSTORE_BASE64
printf '%s' "$PASS" | gh secret set STORE_PASSWORD
printf '%s' "$PASS" | gh secret set KEY_PASSWORD
printf '%s' "autoanna" | gh secret set KEY_ALIAS
echo
echo "Done. The four secrets are in GitHub."
echo "VERY IMPORTANT: copy these two files somewhere safe NOW (Google Drive, email to yourself):"
echo "   $KS"
echo "   $INFO"
echo "If you lose them you can never publish an update to the same app."
