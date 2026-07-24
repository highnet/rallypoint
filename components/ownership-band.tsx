import { FileCode, KeyRound, ScrollText, Unplug } from "lucide-react";

const claims = [
  {
    icon: FileCode,
    title: "Fully customizable",
    detail:
      "Every installed file is plain text — roles, config, scripts. Edit it, delete it, rewrite it. There is no proprietary format to work around.",
  },
  {
    icon: Unplug,
    title: "You download the starting point",
    detail:
      "“Add loop” writes real files into your repository once. From that moment they're yours to change, not a subscription you keep renting.",
  },
  {
    icon: KeyRound,
    title: "The agents live in your codebase",
    detail:
      "Every role runs inside your own repository, your own CI, your own credentials. Nothing calls home, because there is no Rallypoint server to call.",
  },
  {
    icon: ScrollText,
    title: "Ongoing, non-exclusive MIT license",
    detail:
      "What gets installed is MIT-licensed, permanently and non-exclusively. If Rallypoint disappears tomorrow, what's already in your repository keeps working and stays yours.",
  },
];

export function OwnershipBand() {
  return (
    <ol className="rule-list ownership-list">
      {claims.map(({ icon: Icon, title, detail }) => (
        <li key={title}>
          <span aria-hidden="true">
            <Icon />
          </span>
          <div>
            <p className="ownership-title">{title}</p>
            <p>{detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
