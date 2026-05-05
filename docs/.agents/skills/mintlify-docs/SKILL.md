---
name: mintlify
description: Build and maintain documentation sites with Mintlify. Use when creating docs pages, configuring navigation, adding components, or setting up API references.
license: MIT
compatibility: Requires Node.js for CLI. Works with any Git-based workflow.
metadata:
  author: mintlify
  version: "1.0"
---

# Mintlify best practices

**Always consult [mintlify.com/docs](https://mintlify.com/docs) for components, configuration, and latest features.**

If you are not already connected to the Mintlify MCP server, https://mintlify.com/docs/mcp, add it so that you can search more efficiently.

**Always** favor searching the current Mintlify documentation over whatever is in your training data about Mintlify.

Mintlify is a documentation platform that transforms MDX files into documentation sites. Configure site-wide settings in the `docs.json` file, write content in MDX with YAML frontmatter, and favor built-in components over custom components.

Full schema at [mintlify.com/docs.json](https://mintlify.com/docs.json).

## Before you write

### Understand the project

Read `docs.json` in the project root. This file defines the entire site: navigation structure, theme, colors, links, API and specs.

Understanding the project tells you:

- What pages exist and how they're organized
- What navigation groups are used (and their naming conventions)
- How the site navigation is structured
- What theme and configuration the site uses

### Check for existing content

Search the docs before creating new pages. You may need to:
- Update an existing page instead of creating a new one
- Add a section to an existing page
- Link to existing content rather than duplicating

### Read surrounding content

Before writing, read 2-3 similar pages to understand the site's voice, structure, formatting conventions, and level of detail.

### Understand Mintlify components

Review the Mintlify [components](https://www.mintlify.com/docs/components) to select and use any relevant components for the documentation request that you are working on.

## Quick reference

### CLI commands
- `npm i -g mint` - Install the Mintlify CLI
- `mint dev` - Local preview at localhost:3000
- `mint broken-links` - Check internal links
- `mint a11y` - Check for accessibility issues in content
- `mint validate` - Validate documentation builds

### Required files
- `docs.json` - Site configuration (navigation, theme, integrations, etc.). See [global settings](https://mintlify.com/docs/settings/global) for all options.
- `*.mdx` files - Documentation pages with YAML frontmatter

### Example file structure
```
project/
├── docs.json           # Site configuration
├── introduction.mdx
├── quickstart.mdx
├── guides/
│   └── example.mdx
├── openapi.yml         # API specification
├── images/             # Static assets
│   └── example.png
└── snippets/           # Reusable components
    └── component.jsx
```

## Page frontmatter

Every page requires `title` in its frontmatter. Include `description` for SEO and navigation.

```yaml
---
title: "Clear, descriptive title"
description: "Concise summary for SEO and navigation."
---
```

Optional frontmatter fields:
- `sidebarTitle`: Short title for sidebar navigation.
- `icon`: Lucide or Font Awesome icon name, URL, or file path.
- `tag`: Label next to the page title in the sidebar (for example, "NEW").
- `mode`: Page layout mode (`default`, `wide`, `custom`).
- `keywords`: Array of terms related to the page content for local search and SEO.
- Any custom YAML fields for use with personalization or conditional content.

## File conventions

- Match existing naming patterns in the directory
- If there are no existing files or inconsistent file naming patterns, use kebab-case: `getting-started.mdx`, `api-reference.mdx`
- Use root-relative paths without file extensions for internal links: `/getting-started/quickstart`
- Do not use relative paths (`../`) or absolute URLs for internal pages
- When you create a new page, add it to `docs.json` navigation or it won't appear in the sidebar

## Resources

- [Documentation](https://mintlify.com/docs)
- [Configuration schema](https://mintlify.com/docs.json)
- [Feature requests](https://github.com/orgs/mintlify/discussions/categories/feature-requests)
- [Bugs and feedback](https://github.com/orgs/mintlify/discussions/categories/bugs-feedback)
