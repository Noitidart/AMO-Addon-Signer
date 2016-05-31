Created to show a bug where we get 401 error when uploading large XPIs - https://github.com/mozilla/addons-server/issues/2802

This signing process uses `http://currenttimestamp.com/` (if server is down then it uses `http://convert-unix-time.com/`) to get the offset from your system clock. If both servers down, and no previous offset was set, it uses your system clock. If time error does happen it lets you know.

### How to Use
1. Install the XPI in this repository
2. go to about:debugging
3. On "chrome://amo-addon-signer/content/MainWorker.js" click "Debug"
4. Go to "Console" tab
5. Excecute `signUnsignedXpi(OS.Path.join(OS.Constants.Path.desktopDir, 'mediacap - unsigned.xpi'), 'YOUR_KEY_HERE', 'YOUR_SECRET_HERE');` (this will sign `mediacap - unsinged.xpi` file which is on desktop, the first argument is an OS file path.
6. The signed file will be downloaded to the desktop as `signed.xpi` - watch browser console to see status and any errors

#### Screenshots

* Shows successful upload
  ![](http://i.imgur.com/ycuOQ5f.png)
* Shows `401` error on "upload taking too long" error
  ![](http://i.imgur.com/WqLRCSa.png)
