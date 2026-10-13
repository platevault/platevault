# Privacy and network access

PlateVault keeps your library on your computer. It has no accounts and sends
nothing to the maintainer. Its code contains no analytics, telemetry, crash
reporting or advertising. Your data stays in local folders, listed in
[Where your data lives](./12-uninstalling.md#where-your-data-lives).

The app connects to the internet for three features:

- the update check;
- target lookups;
- the observing-site map.

Each section says what the request sends, when it runs, and how to turn it
off or avoid it in the current release.

## Update check (GitHub)

- **Where:** `https://github.com/platevault/platevault/releases/latest/download/latest.json`.
  GitHub may answer from its own download hosts, such as
  `release-assets.githubusercontent.com`.
- **When:** once every time PlateVault starts. After a failed check or
  download, **Settings → Advanced → Software Update → Check again** runs it
  once more.
- **What is sent:** a plain HTTPS request for that file. It carries the
  updater's name and version as its user agent, plus your IP address, as any
  web request does. It does not carry your PlateVault version, your library
  or anything about your files.
- **What follows:** if the file lists a newer version, PlateVault downloads the
  update package for your platform from GitHub straight away and checks its
  signature before using it.
- **How to turn it off:** the current release has no setting for this. To
  stop it, block `github.com` for PlateVault in your firewall.
- **GitHub's policy:** [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

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
  - You type a target name of two or more characters in a target search box,
    and it matches nothing local. The lookup runs after a short pause in
    typing.
  - You choose **Search more catalogues (NED/VizieR)** after a search finds
    nothing.
  - You apply an Inbox plan. PlateVault reads the `OBJECT` header of each new
    light frame and looks up any name it does not know yet. Names it could not
    look up stay queued, and a background task retries them every 30 seconds.
  - The Inbox shows a **Suggested target** for a light group, or you choose
    **Re-check** there. PlateVault sends the sky position from the frames'
    FITS headers and a search radius, and asks which objects lie in that
    area.
- **What is sent:** the target name or `OBJECT` header value, or the sky
  position (right ascension, declination and radius). The user agent names
  the lookup library and its version. CDS also sees your IP address.
- **How to turn it off:** switch off **Settings → Target Resolution → Online
  SIMBAD resolution**. The same switch appears in the **Configuration** step
  of first-run setup. It is on by default. With it off, searches and imports
  use only the bundled catalogue and the local cache, and the Inbox target
  suggestions say they are unavailable offline.
- **CDS policy:** [CDS terms and privacy](https://cds.unistra.fr/legals/#privacy).

## Observing-site map (OpenStreetMap)

- **Where:** map tiles from `a.tile.openstreetmap.org`,
  `b.tile.openstreetmap.org` and `c.tile.openstreetmap.org`, over HTTPS.
- **When:** whenever the **Pick on map** map is on screen: the **Observing
  Site** step of first-run setup, and the add or edit form under **Settings →
  Target Planner → Observing Sites**. The map loads as soon as the form opens,
  before you click anything.
- **What is sent:** requests for the map tiles on display, along with your IP
  address and the standard headers of the app's built-in web view. When you
  have entered coordinates, the map centres on them, so the tiles requested
  show roughly where your site is.
- **How to avoid it:** the current release has no setting for this, and the
  add and edit forms always show the map. To avoid the requests, skip the
  **Observing Site** step and do not open the site form, or block
  `*.tile.openstreetmap.org` in your firewall.
- **OpenStreetMap's policies:** [OSMF Privacy Policy](https://osmfoundation.org/wiki/Privacy_Policy)
  and [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).

## Links you open yourself

**Settings → Target Resolution** credits SIMBAD and OpenNGC with links to
their websites. These open only when you click them.

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
