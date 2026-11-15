# Google Health: set up the browser sign-in test

*Backlog item 20, step 1. This is a test, not the finished feature: it finds out whether Google lets a web page sign in to the Google Health API with no backend. It takes about 20 minutes. Nothing in the app changes. A client secret is never needed for this test and must never be pasted into the repository, the page or a chat; you only ever copy the public Client ID.*

## What this does
You create a free Google Cloud project that only you can use, then run a small test page on your own computer (`tools/google-health-probe/`). The page signs you in with Google, reads your steps and sleep for the last three days, and shows Google's exact answers so we learn what is allowed.

## 1. Create a Google Cloud project
1. Open https://console.cloud.google.com/ and sign in with the Google account that you use in the Google Health app.
2. At the top, open the project picker and choose **New project**. Name it `macro-diary-health-test`. No organisation. Create it, then make sure it is the selected project.

## 2. Enable the Google Health API
1. In the console search bar type **Google Health API**, open it and press **Enable**.

## 3. Set up the OAuth consent screen
1. Go to **APIs & Services**, then **OAuth consent screen** (it may be called **Google Auth Platform**).
2. User type: **External**. App name: `Macro Diary test`. Support email and developer email: your own.
3. Publishing status must stay **Testing** (do not press Publish).
4. Under **Audience**, then **Test users**, add your own Google email as a **test user**. Only test users can sign in while the app is in Testing.

## 4. Add the scopes
1. Open **Data Access** (or **Scopes**), then **Add or remove scopes**.
2. Add exactly these two, and nothing else:
   - `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
   - `https://www.googleapis.com/auth/googlehealth.sleep.readonly`
3. If a scope does not appear in the list, paste it into **Manually add scopes**. Save.

## 5. Create the OAuth client
1. Go to **Credentials**, then **Create credentials**, then **OAuth client ID**.
2. Application type: **Web application**. Name: `probe`.
3. **Authorized JavaScript origins**: add both `http://localhost:8080` and `https://ahaselden.github.io`. Leave redirect URIs empty.
4. Create it. Copy only the **Client ID** (it ends in `.apps.googleusercontent.com`). Google may show a client secret: ignore it, never copy it, and never paste it anywhere.

## 6. Link your account in the Google Health app
1. On your phone, open the **Google Health** app and make sure you are signed in with the same Google account. Without this Google answers `ACCOUNT_NOT_LINKED` and the test cannot read data.

## 7. Run the probe
1. In a terminal in the app's folder run `npm start`.
2. Open http://localhost:8080/tools/google-health-probe/ in your browser.
3. Paste your Client ID and press **Sign in with Google**.
4. Choose your account and approve the two permissions.
5. Tick **show the numbers** if you want the steps and sleep values included in the summary (leave it unticked to share only pass or fail).

## What to expect
- Google shows a screen saying the app is **not verified**. That is normal for a test project: press **Advanced**, then **Continue** (or the equivalent link).
- The sign-in token lasts **1 hour** and there is no refresh token in this browser-only flow, so a new sign-in is needed each time. That is part of what we are testing.
- Three checks run: the account link, your steps for the last three days, and your sleep for the last three days. Each shows `HTTP 200 - ok` or an error from Google.
- If sign-in itself fails, the page shows Google's error (for example `invalid_scope`, `access_denied` or `popup_closed`). That error is the answer to our question, so do not retry blindly: copy it.

## What to send back
1. Press **Copy result summary** and paste the text to Claude. It never contains the token or your email address, and it contains steps and sleep numbers only if you ticked the box.
2. Say whether you saw the "not verified" screen and whether the numbers look like what the Google Health app shows for the same days.

## Delete the project and revoke access afterwards
1. To stop the test: open https://myaccount.google.com/permissions, find `Macro Diary test` and choose **Delete all connections** to revoke access.
2. To delete the project: in the Cloud console open **IAM & Admin**, then **Settings**, choose **Shut down** and confirm. It is removed after a short waiting period. You can also keep it for the next step; it costs nothing.
