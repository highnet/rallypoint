const claims = [
  {
    title: "Plain text, fully yours to edit",
    detail:
      "Every installed file is plain text — roles, config, scripts. Edit it, delete it, rewrite it. There is no proprietary format to work around.",
  },
  {
    title: "Downloaded once, not rented",
    detail:
      "“add loop” writes real files into your repository once. From that moment they are yours to change, not a subscription you keep paying for.",
  },
  {
    title: "Runs where your code runs",
    detail:
      "Every role runs inside your repository, your CI, your credentials. Nothing calls home, because there is no Rallypoint server to call.",
  },
  {
    title: "MIT, permanently",
    detail:
      "What gets installed is MIT-licensed, permanently and non-exclusively. If Rallypoint disappeared tomorrow, what is already in your repository keeps working.",
  },
];

export function OwnershipBand() {
  return (
    <dl className="ownership">
      {claims.map(({ title, detail }) => (
        <div key={title}>
          <dt>{title}</dt>
          <dd>{detail}</dd>
        </div>
      ))}
    </dl>
  );
}
