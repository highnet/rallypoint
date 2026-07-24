const sections = [
  { href: "#principles", label: "Principles" },
  { href: "#roles", label: "Roles" },
  { href: "#install", label: "Install" },
  { href: "#prompting", label: "Prompting" },
];

export function DocsQuickNav() {
  return (
    <nav aria-label="Jump to section" className="docs-quick-nav">
      {sections.map((section, index) => (
        <a href={section.href} key={section.href}>
          <span aria-hidden="true" className="docs-quick-nav-hex">
            {index + 1}
          </span>
          <span className="docs-quick-nav-label">{section.label}</span>
        </a>
      ))}
    </nav>
  );
}
