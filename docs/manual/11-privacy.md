# Privacy and network access

PlateVault keeps your library on your computer. It has no accounts and sends
nothing to the maintainer. Its code contains no analytics, telemetry, crash
reporting or advertising. Your data stays in local folders, listed in
[Where your data lives](./12-uninstalling.md#where-your-data-lives).

The app connects to the internet for three features:

- update checks;
- target lookups;
- the observing-site map.

Each section says what the request sends, when it runs, and how to turn it
off or avoid it in the current release.

## Update checks (GitHub)

PlateVault checks for updates in two ways: automatically at startup, and
manually when you ask. Both send the same request to the same place.

- **Where:** `https://github.com/platevault/platevault/releases/latest/download/latest.json`.
  GitHub may answer from its own download hosts, such as
  `release-assets.githubusercontent.com`.
- **What is sent:** a plain HTTPS request for that file. It carries the
  updater's name and version as its user agent, plus your IP address, as any
  web request does. It does not carry your PlateVault version, your library
  or anything about your files.

### Automatic check

- **When:** once every time PlateVault starts. It does not repeat on a
  schedule while the app runs.
- **What is sent:** the request described above, to `github.com`.
- **How to turn it off:** switch off **Settings → Advanced → Software Update → Check for updates automatically**. The same switch appears on the **Configuration** step of first-run setup, next to **Online SIMBAD resolution**. It is on by default. With it off, PlateVault sends no update request at startup or at any other time unless you check manually. **Reset preferences** in **Settings → Advanced** turns it back on.
- **Releases without the setting:** up to and including the 0.6.x releases,
  the check runs at every start and cannot be turned off. To stop it there,
  block `github.com` for PlateVault in your firewall.

### Manual check

- **When:** only when you click **Check for updates**, or **Check again**
  after a failed check, in **Settings → Advanced → Software Update**. It works
  whether the automatic check is on or off.
- **What is sent:** the same request, to `github.com`, once per click.

### What follows a check

This depends on the version you run.

- Up to and including the 0.6.x releases, PlateVault downloads and installs
  the update for your platform from GitHub as soon as the check finds one, at
  launch. On Windows the installer starts and PlateVault quits.
- From 0.7.0, PlateVault tells you about the update and downloads nothing
  until you choose **Install now** or **Install on quit**. It then downloads
  the update package from GitHub and checks its signature before installing
  it.

**GitHub's policy:** [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Target lookups (CDS SIMBAD, Strasbourg)

PlateVault ships a catalogue of common targets and keeps a local cache of
every name it has resolved. For a name in neither, and for Inbox target
suggestions, it asks the SIMBAD service of the Centre de Données
astronomiques de Strasbourg (CDS).

- **Where:** `https://simbad.cds.unistra.fr/simbad/sim-tap/sync` by default.
  To use another server, change **Settings → Target Resolution → SIMBAD
  endpoint**.
  **Search more catalogues (NED/VizieR)** uses the CDS Sesame service at
  `https://cds.unistra.fr`, which searches SIMBAD, NED and VizieR for you.
- **When:**
  - You pause while typing two or more characters in a target search box.
    PlateVault sends what you have typed so far, even when local results
    already appear, unless that exact name is in its local cache.
  - You choose **Search more catalogues (NED/VizieR)** after a search finds
    nothing.
  - You apply an Inbox plan. PlateVault reads the `OBJECT` header of each new
    light frame and looks up any name it does not know yet. Names it could not
    look up stay queued, and a background task retries them every 30 seconds.
  - The Inbox shows a **Suggested target** for a light group, or you choose
    **Re-check** there. PlateVault sends the sky position from the frames'
    FITS headers and a search radius, and asks which objects lie in that
    area.
- **What is sent:** the text typed so far, a target name, an `OBJECT` header
  value, or a sky position (right ascension, declination and radius). The
  user agent names the lookup library and its version. CDS also sees your IP
  address.
- **How to turn it off:** switch off **Settings → Target Resolution → Online
  SIMBAD resolution**. The same switch appears in the **Configuration** step
  of first-run setup. It is on by default. With it off, searches and imports
  use only the bundled catalogue and the local cache, and the Inbox target
  suggestions say they are unavailable offline.
- **CDS policy:** [CDS terms and privacy](https://cds.unistra.fr/legals/#privacy).

## Observing-site map (OpenStreetMap)

The **Pick on map** section appears in the **Observing Site** step of
first-run setup and in the add or edit form under **Settings → Target
Planner → Observing Sites**. It shows a short notice and a **Show map**
button in place of the map.

- **Where:** map tiles from `a.tile.openstreetmap.org`,
  `b.tile.openstreetmap.org` and `c.tile.openstreetmap.org`, over HTTPS.
- **When:** only after you click **Show map**, and only while that step or
  form stays open. Opening the step or the form sends nothing. The choice is
  not remembered. The map is hidden again until you click **Show map** each
  time you open the step or a form. This includes switching an open form to
  another site with **Edit** or **+ Add site**.
- **What is sent:** requests for the map tiles on display, along with your IP
  address and the standard headers of the app's built-in web view. Each tile
  covers a known patch of the world, so the tiles requested reveal the area
  you are looking at. When you have entered coordinates, the map opens
  centred on them, so the tiles show roughly where your site is.
- **How to avoid it:** do not click **Show map**. Type the latitude and
  longitude into their fields instead. The site works the same without the
  map.
- **Releases without the button:** up to and including the 0.6.x releases,
  the map loads as soon as the step or form opens, before you click
  anything. Those releases cannot turn it off. To avoid the requests there,
  skip the **Observing Site** step and do not open the site form, or block
  `*.tile.openstreetmap.org` in your firewall.
- **OpenStreetMap's policies:** [OSMF Privacy Policy](https://osmfoundation.org/wiki/Privacy_Policy)
  and [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).

## Links you open yourself

**Settings → Target Resolution** credits SIMBAD and OpenNGC with links to
their websites. Once you click **Show map**, the map shows OpenStreetMap and
Leaflet credits, which link to their websites. These links open in your
browser only when you click them.

## During installation on Windows

PlateVault draws its window with Microsoft Edge WebView2. When WebView2 is
missing, the Windows installers download Microsoft's WebView2 installer and
run it. That download happens during installation only. PlateVault's own
code does not contact Microsoft.

## Related

- [Code signing policy](../release/code-signing-policy.md)
- [Uninstalling PlateVault](./12-uninstalling.md)
- [Targets and planning](./07-targets-and-planning.md), for how lookups fit
  into the target catalogue
