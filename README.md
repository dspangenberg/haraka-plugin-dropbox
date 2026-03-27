[![CI Test Status][ci-img]][ci-url]
[![Code Climate][clim-img]][clim-url]

# haraka-plugin-dropbox

Haraka plugin that forwards incoming emails to configured Dropbox webhook URLs. Each recipient address can be mapped to a specific Dropbox webhook endpoint in the configuration.

## INSTALL

```sh
cd /path/to/local/haraka
npm install haraka-plugin-dropbox
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
invoice@example.com=https://your-dropbox-webhook.example.com/ingest
support@example.com=https://your-dropbox-webhook.example.com/tickets
```

## USAGE

The plugin intercepts emails at the `data_post` hook and forwards them as JSON payloads to the configured Dropbox webhook URLs. Each email is sent with the following structure:

```json
{
  "payload": {
    "from": ["sender@example.com"],
    "to": ["recipient@example.com"],
    "rcpt_to": "recipient@example.com",
    "cc": [],
    "bcc": [],
    "subject": "Email Subject",
    "message_id": "<unique-id@example.com>",
    "attachments": [],
    "html": "<html>...",
    "text": "Plain text body",
    "textAsHtml": "...",
    "timestamp": "2024-01-01T00:00:00.000Z",
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
