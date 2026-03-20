# Booking Form → Google Sheets Setup

## One-time setup (5 minutes)

### 1. Create a Google Sheet
- Go to sheets.google.com → New spreadsheet
- Name it: **Gaia Symbiosis Enquiries**
- Add headers in row 1:
  `Timestamp | First Name | Last Name | Email | Organisation | Service | Message`

### 2. Create a Google Apps Script
- In the sheet: **Extensions → Apps Script**
- Delete any existing code and paste this:

```javascript
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data  = JSON.parse(e.postData.contents);
  sheet.appendRow([
    data.timestamp,
    data.firstName,
    data.lastName,
    data.email,
    data.organisation,
    data.service,
    data.message
  ]);
  return ContentService
    .createTextOutput(JSON.stringify({ result: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

### 3. Deploy as Web App
- Click **Deploy → New deployment**
- Type: **Web app**
- Execute as: **Me**
- Who has access: **Anyone**
- Click **Deploy** → copy the URL

### 4. Paste the URL into index.html
Open `index.html` and replace:
```
const APPS_SCRIPT_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';
```
with your copied URL.

### 5. Add your profile photo
Drop your photo into the `assets/` folder named exactly:
```
assets/profile.jpg
```
Recommended: square crop, minimum 400×400px.
