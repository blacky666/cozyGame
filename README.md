# cozyGame

Eine Online-Minispiel-Party für 2 bis 4 Freunde im Browser. Albern, schadenfroh, gemütlich.

> **Status:** In Planung. Noch nicht spielbar.

## Idee

- Einer erstellt einen Raum, teilt den Code (z. B. über Discord), die anderen treten bei.
- Pro Abend 5 bis 8 Runden aus zufälligen Minispielen, mit Zwischenstand und einer kleinen Gemeinheit für den Letzten.
- XP, Level, freischaltbare Skins, Emotes und Streiche, mit denen man die anderen ärgern kann.
- Kein Login. Der Fortschritt wird lokal im Browser gespeichert.

## Minispiele

- **Heiße Kartoffel**: Wer die tickende Kartoffel beim Knall hält, fliegt raus.
- **Farbkrieg**: Wer am Ende die meiste Fläche in seiner Farbe hat, gewinnt.
- **Wackel-Turm**: Baue aus fallenden Klötzen den höchsten Turm.
- **Schneeball-Schlacht**: Treffen bringt Punkte, getroffen werden kostet welche.

## Technik

- [Phaser](https://phaser.io/) (HTML5 Canvas), TypeScript, Vite
- Peer-to-peer über WebRTC ([Trystero](https://github.com/dmotz/trystero)), der Browser des Gastgebers ist der Server
- Gehostet auf GitHub Pages
- 16-Bit-Pixel-Art
