// Schoolinstellingen. Voor een andere school pas je alleen dit bestand aan.
export const SCHOOL = {
  naam: 'Melanchthon Mavo Schiebroek',
  logoRegel1: 'MELANCHTHON',
  logoRegel2: 'MAVO SCHIEBROEK',
  // Hoe het schoolmailadres van een leerling is opgebouwd, als de export geen e-mailkolom heeft.
  // {nr} wordt vervangen door het leerlingnummer.
  leerlingEmail: 'l3{nr}@cvo.nl',
  // Hoe het mailadres van een docent is opgebouwd (mentorexport Zermelo heeft geen e-mailkolom)
  docentEmail: '{v}.{achternaam}@cvo.nl',
  standaardDuur: 20,
  // Standaard eetpauze bij het maken van tijdslots (mentor kan dit per keer aanpassen of leegmaken)
  eetpauze: ['17:00', '18:00'],
  // Logo: vervang public/logo.png
}
