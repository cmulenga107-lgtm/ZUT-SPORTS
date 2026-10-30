ZUT SPORTS WEBSITE TEMPLATE
===========================

Files
-----
index.html   Homepage with sports categories and sample sports articles
sports.html   Directory of listed sports and related skill guides
articles.html Guides for balancing study and sport, plus sport-specific practice tips
article.html Sample article detail page
news.html    Match reports, transfers, player updates and photo gallery
Tables.html  ZUT Premier League standings and fixtures
login.html   Login form interface
signup.html  Sign-up form interface
CSS/styles.css Shared layout, colours and responsive styles
javascript/script.js Mobile menu, account forms and current year
server.js    Static site server and SQLite account API
server.test.js Backend tests
package.json  Node scripts and runtime requirement

Run locally
-----------
Requires Node.js 22.13 or newer. The backend uses Node's built-in SQLite support
and has no third-party package dependencies.

1. Open a terminal in this folder.
2. Run `npm start`.
3. Open http://localhost:3000. You will be asked to log in or create an account
   before you can access the site pages.
4. Run `npm test` to test account and session behavior.

The SQLite database is created at `data/zut-sports.sqlite` on first run. Signup,
login and logout use the local API; passwords are stored as scrypt hashes and
sessions use HTTP-only cookies. Site pages require an active session, including
when opened directly by URL. Opening the HTML files directly with `file://` does
not provide the account API or sign-in protection.

Important
---------
This is a local development backend, not a production-ready public auth service.
Before public deployment, use HTTPS, set `NODE_ENV=production` and configure
`APP_ORIGIN` to the exact public origin. Do not reuse personal passwords here.

Sports categories and articles are placeholders, not verified ZUT records.
Replace them with the official list of sports and fact-checked ZUT stories
before publishing the website.

Next development steps
----------------------
1. Confirm the sports offered at ZUT.
2. Add real article content and images.
3. Confirm deployment hosting, HTTPS and database backup requirements.
4. Add account recovery and role-based access if the site needs them.
