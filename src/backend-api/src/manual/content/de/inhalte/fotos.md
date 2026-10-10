# Fotos

Unter **Bibliothek › Fotos** wählst du Ordner auf dem NAS, deren Bilder die Kinder auf dem Display anschauen können – wie ein Fotoalbum aus dem Regal. Die Bilder bleiben auf dem NAS; die Box holt sie sich in Display-Größe und merkt sie sich auf der Speicherkarte.

Dafür muss die Box beim NAS angemeldet sein ([NAS](nas.md)). Ohne Anmeldung zeigt die Seite einen Hinweis und den Knopf **Zur NAS-Seite**.

## Ordner hinzufügen

**Ordner hinzufügen** öffnet die Ordner des NAS, eine Ebene nach der anderen. Oben steht der Weg bis zum gezeigten Ordner, darunter seine Unterordner: Ein Tipp auf einen Unterordner öffnet ihn, ein Tipp auf den Weg führt zurück. Unter der Liste sagt die Box, was aus dem gezeigten Ordner würde, zum Beispiel „2 Unterordner werden Alben · 3 Bilder direkt im Ordner“. **Diesen Ordner wählen** übernimmt ihn.

Jeder gewählte Ordner steht danach unter **Fotoordner**, mit seinem Pfad auf dem NAS. **Entfernen** nimmt ihn wieder heraus; auf dem NAS ändert sich dabei nichts. Bis zu 20 Ordner sind möglich. Ein Ordner, der in einem gewählten Ordner liegt oder einen enthält, lässt sich nicht zusätzlich wählen.

## So entstehen die Alben

Die Box schaut genau eine Ebene tief:

| Auf dem NAS | Auf dem Display |
| --- | --- |
| ein Unterordner des gewählten Ordners mit Bildern | ein Album mit dem Namen des Unterordners |
| Bilder direkt im gewählten Ordner | ein Album mit dem Namen des gewählten Ordners |
| ein Unterordner ohne Bilder | kein Album |
| Ordner tiefer als eine Ebene, Dateien, die keine Bilder sind | werden übergangen |

Ein Beispiel: Der Ordner `Familie 2026` enthält die Unterordner `Zoo` und `Oma 70` und ein paar Bilder direkt darin. Auf dem Display erscheinen die Alben „Zoo“, „Oma 70“ und „Familie 2026“. Die zuletzt geänderten Alben stehen vorn; die Bilder in einem Album sind nach Dateinamen sortiert, so wie die Kamera sie nummeriert.

## Bilder

Die Box zeigt JPEG, PNG und WebP sowie HEIC, wie es das iPhone aufnimmt. Hochkant aufgenommene Fotos stehen richtig herum. Videos werden nicht gezeigt.

Die Box wandelt jedes Bild in eine Kopie in Display-Größe um und behält sie auf der Speicherkarte. Das erste Öffnen eines Albums mit HEIC-Bildern vom iPhone dauert deshalb einen Moment, besonders auf einem kleinen Raspberry Pi; danach geht es schnell.

## Der Reiter auf dem Display

Sobald der erste Ordner gewählt ist, bekommt das Display den Reiter **Fotos** neben Hörspiele, Musik und den anderen Reitern ([Die Startseite](../bedienung/startseite.md)). Ein Tipp auf ein Album öffnet es, wischen blättert, ein Doppeltipp vergrößert das Bild, der Pfeil oben führt zurück. Solange jemand durch die Bilder blättert, schaltet sich die Box nicht von selbst ab; fünf Minuten nach der letzten Berührung gilt sie wieder als unbenutzt.

Mit **Fotos-Reiter ausblenden** auf der Seite Fotos oder unter **Einstellungen › Display & Bedienung › Bedienung am Display** verschwindet der Reiter; die Ordner bleiben gewählt.

## Wenn etwas fehlt

- **Kein Reiter Fotos**: Es ist kein Ordner gewählt, oder der Reiter ist ausgeblendet.
- **Ein Album fehlt**: Der Unterordner enthält keine Bilder, oder die Bilder liegen tiefer als eine Ebene. Lege sie direkt in den Unterordner.
- **Ein Bild fehlt**: Die Datei ist kein JPEG, PNG, WebP oder HEIC, oder die Box konnte sie nicht lesen. Für HEIC braucht die Box ein Hilfsprogramm, das Installation und Update mitbringen.
- **Die Alben lassen sich nicht laden**: Das NAS antwortet nicht, oder die Anmeldung ist abgelaufen – siehe [NAS](nas.md).
- **Neue Bilder erscheinen nicht sofort**: Die Box liest die Ordner nach kurzer Zeit von selbst neu.
