[![CI Test Status][ci-img]][ci-url]
[![Code Climate][clim-img]][clim-url]

# haraka-plugin-dropbox

[Haraka](https://github.com/haraka/Haraka) plugin that forwards incoming emails to configured Dropbox webhook URLs. Each recipient address can be mapped to a specific Dropbox webhook endpoint in the configuration.

## INSTALL

```sh
cd /path/to/local/haraka
npm install git@github.com:dspangenberg/haraka-plugin-dropbox.git --legacy-peer-deps
echo "dropbox" >> config/plugins
service haraka restart
```

### Configuration

Copy the config file from the distribution into your Haraka config dir and modify it:

```sh
cp node_modules/haraka-plugin-dropbox/config/dropbox.ini config/dropbox.ini
$EDITOR config/dropbox.ini
```

Edit `config/dropbox.ini` to map recipients to webhook URLs:

```ini
[dropboxes]
invoice@dropbox.example.com=https://your-tenant.example.com/invoice@example.com/GYrLasLWEiBeywiDtshilEq5Ztr6HSsy
support@dropbox.example.com=https://your-other-tenant.example.com/invoice@example.com/hrm2sjv4YUGyZFRLJvmSnfUpRUr4kE0U
```

### Queue Integration

This plugin sets `connection.transaction.notes.discard = true` after successfully forwarding an email to a Dropbox webhook. This prevents Haraka from delivering the email to its original recipients.

To use this feature, you must:

1. Enable the `queue/discard` plugin in `config/plugins`
2. Configure it to run on the `queue` hook

**Important:** The `dropbox` plugin must be loaded before other queue plugins in `config/plugins`. The discard flag is checked during the queue phase, so the `queue/discard` plugin (and any real queue plugins like `queue/smtp`) must be listed after `dropbox` to ensure the flag is respected.

Example `config/plugins`:

```ini
# Load dropbox first - it sets the discard flag after successful webhook delivery
dropbox

# Then load queue plugins - queue/discard checks the discard flag
# and prevents delivery; queue/smtp delivers if discard is not set
queue/discard
queue/smtp
```

## USAGE

The plugin intercepts emails at the `data_post` hook and forwards them as JSON payloads to the configured Dropbox webhook URLs. Each email is sent with the following structure:

```json
{
  "payload": {
    "from": "sender@example.com",
    "to": ["recipient@example.com"],
    "rcpt_to": "recipient@example.com",
    "cc": [],
    "bcc": [],
    "subject": "Email Subject",
    "message_id": "<unique-id@example.com>",
    "attachments": [],
    "html": "<html>...",
    "text": "Plain text body",
    "plain_body: "Text body without quotes",
    "textAsHtml": "...",
    "date": "2024-01-01T00:00:00.000Z",
    "references": [],
    "in_reply_to": false
  }
}
```

<!-- leave these buried at the bottom of the document -->

[ci-img]: https://github.com/dspangenberg/haraka-plugin-dropbox/actions/workflows/ci.yml/badge.svg
[ci-url]: https://github.com/dspangenberg/haraka-plugin-dropbox/actions/workflows/ci.yml
[clim-img]: https://codeclimate.com/github/dspangenberg/haraka-plugin-dropbox/badges/gpa.svg
[clim-url]: https://codeclimate.com/github/dspangenberg/haraka-plugin-dropbox
