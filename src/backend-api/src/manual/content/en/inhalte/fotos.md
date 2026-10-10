# Photos

Under **Library › Photos** you choose folders on the NAS whose pictures the children can look at on the display – like a photo album taken from the shelf. The pictures stay on the NAS; the box fetches them at display size and keeps them on the memory card.

For this the box must be signed in to the NAS ([NAS](nas.md)). Without that the page shows a note and the button **To the NAS page**.

## Adding a folder

**Add folder** opens the folders of the NAS, one level at a time. At the top is the path to the folder shown, below it its subfolders: a tap on a subfolder opens it, a tap on the path leads back. Under the list the box says what would become of the folder shown, for example “2 subfolders become albums · 3 pictures directly in the folder”. **Choose this folder** takes it.

Every chosen folder is then listed under **Photo folders**, with its path on the NAS. **Remove** takes it out again; nothing changes on the NAS. Up to 20 folders are possible. A folder that is inside a chosen folder or contains one cannot be chosen in addition.

## How the albums come about

The box looks exactly one level deep:

| On the NAS | On the display |
| --- | --- |
| a subfolder of the chosen folder with pictures | an album named after the subfolder |
| pictures directly in the chosen folder | an album named after the chosen folder |
| a subfolder without pictures | no album |
| folders deeper than one level, files that are not pictures | are skipped |

An example: the folder `Familie 2026` contains the subfolders `Zoo` and `Oma 70` and a few pictures directly in it. The display shows the albums “Zoo”, “Oma 70” and “Familie 2026”. The albums changed most recently come first; the pictures in an album are sorted by file name, the way the camera numbers them.

## Pictures

The box shows JPEG, PNG and WebP as well as HEIC, the format the iPhone records. Photos taken upright stand the right way up. Videos are not shown.

The box turns every picture into a copy at display size and keeps it on the memory card. Opening an album with HEIC pictures from the iPhone for the first time therefore takes a moment, especially on a small Raspberry Pi; after that it is quick.

## The tab on the display

As soon as the first folder is chosen, the display gets the tab **Photos** next to Audiobooks, Music and the other tabs ([The start page](../bedienung/startseite.md)). A tap on an album opens it, swiping leafs through, a double tap enlarges the picture, the arrow at the top leads back. While pictures are being looked at, the box does not switch itself off.

With **Hide Photos tab** on the Photos page or under **Settings › Display & controls › Controls on the display** the tab disappears; the folders stay chosen.

## When something is missing

- **No Photos tab**: no folder is chosen, or the tab is hidden.
- **An album is missing**: the subfolder contains no pictures, or the pictures are deeper than one level. Put them directly into the subfolder.
- **A picture is missing**: the file is not a JPEG, PNG, WebP or HEIC, or the box could not read it. For HEIC the box needs a helper program that the installation and the update bring along.
- **The albums do not load**: the NAS does not answer, or the sign-in has expired – see [NAS](nas.md).
- **New pictures do not appear at once**: the box reads the folders again by itself after a short while.
