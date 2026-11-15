# Telegram Restriction Tool

A userscript for downloading media in Telegram Web and using in-memory copy media uploads to 'forward' media.

## Features

- Download photos, videos, GIFs, stories, and available audio, including media whose normal save controls are hidden.
- Support for various Telegram Web versions through the same three Telegram web domains as the supplied script.
- Two concurrent downloads, a download queue, progress and speed indicators, cancellation, retry, and dismissible history.
- Direct audio/video saving when the browser supports the save-file picker; ordinary browser downloads otherwise.
- Response type, byte count, and partial-download validation, plus a 30-second network inactivity timeout.
- **Send a copy** (in Web K) from the media viewer or selected messages, with up to 256 MiB of staged media in memory.
- Photo/video groups of up to 10 attachments, GIF-to-MP4 conversion, and original-byte handling for silent MP4 files.
- Upload-preview checks for the account, destination, and album grouping. The optional **Skip album check** switch applies only to the current preview.
- Light/dark styling, keyboard access, progress announcements, and reduced-motion support.

The script can use only media already accessible to your signed-in Telegram account. It does not add access to other chats or channels.

## Install

1. Fill in the metadata above.
2. Install a userscript manager, such as Tampermonkey or Violentmonkey, in your browser.
3. Create a new userscript and replace its contents with `tg-restriction-tool.user.js`, then save it. Alternatively, after publishing your repository, open the raw `.user.js` file and follow your manager's installation prompt.
4. Open or reload Telegram Web K (`https://web.telegram.org/k/`) or Web A (`https://web.telegram.org/a/`).

The script has no runtime package dependencies. Installing it does not require Node.js or npm. Disable another installed copy if it creates duplicate controls.

## Download media

Open a photo, video or GIF then use its download button. In Web K, the pinned audio player also gets a download button when its media source is available.

For audio/video, a supported browser may ask where to save the file. Other downloads are handed to the browser after buffering in memory. The panel distinguishes a completed direct write from a download handed to the browser; the latter does not confirm that the browser finished saving it.

## Send a copy (Web K)

1. Open an original media message in the viewer, or select media messages in the main conversation.
2. Click **Send a copy** and wait for the media to load into memory.
3. Close the viewer or cancel the selection, then open the destination chat or topic.
4. Click **Prepare upload**.
5. Review Telegram's attachment preview and destination, then press Telegram's **Send** button yourself.

The attachments are new uploads. Original captions and forwarding attribution are not copied. Audio or a voice note must be copied separately from a photo/video album. Groups larger than 10 are split into batches of at most 10.

Actual GIF images are converted to MP4 with a silent audio track for album handling. Keep the tab visible during conversion. Conversion requires browser support for GIF decoding, canvas capture, MP4 recording, and audio processing; one animation cycle may last up to three minutes. Existing silent MP4 files keep their original bytes and use Web K's prepared-video preview path.

**Minimize** retains staged files in the tab; **Discard** releases the script's references and closes its copy preview. Closing or reloading the tab loses staged copies. Once the preview takes the files, Telegram owns their upload or cancellation workflow. The script does not automatically press Send or verify eventual server delivery.
