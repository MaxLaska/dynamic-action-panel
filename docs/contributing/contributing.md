## 🤝 Contributing

We welcome contributions from the community! Here's how you can help:

### 🚀 Quick Start

1. **Fork** the repository
2. **Clone** your fork locally
3. **Create** a feature branch: `git checkout -b feature/amazing-feature`
4. **Make** your changes
5. **Test** thoroughly
6. **Commit** with clear messages: `git commit -m 'Add amazing feature'`
7. **Push** to your branch: `git push origin feature/amazing-feature`
8. **Open** a Pull Request

### 📋 Contribution Guidelines

#### 🐛 Bug Reports

- Use the [bug report template](https://github.com/MaxLaska/dynamic-action-panel/issues/new?template=bug_report.md)
- Include steps to reproduce
- Describe expected vs actual behavior
- Provide system information (OS, Obsidian version, plugin version)

#### 💡 Feature Requests

- Use the [feature request template](https://github.com/MaxLaska/dynamic-action-panel/issues/new?template=feature_request.md)
- Explain the problem you're trying to solve
- Describe your proposed solution
- Consider implementation complexity

#### 🔧 Code Contributions

- Follow the existing code style and conventions
- Add tests for new features
- Update documentation as needed
- Ensure all tests pass before submitting

#### 📚 Documentation

- Improve README files
- Add code comments
- Create tutorials or guides
- Translate to other languages

### 🛠️ Development Setup

```bash
# Clone the repository
git clone https://github.com/MaxLaska/dynamic-action-panel.git
cd dynamic-action-panel

# Install dependencies
npm install

# Start development mode (watch build, writes only to dist/)
npm run dev

# Build for production (writes only to dist/)
npm run build

# Run tests
npm test

# Typecheck + lint + tests in one go
npm run verify
```

Neither `dev` nor `build` writes into an Obsidian vault. To try the plugin out,
copy `dist/main.js`, `dist/styles.css` and `dist/manifest.json` into
`YourVault/.obsidian/plugins/dynamic-action-panel/`.

`npm run deploy:smoke` and `npm run deploy:prod` exist for the maintainer's two
machines and are hard-wired to those vaults in `DEPLOY_TARGETS`
(`scripts/deployCore.mjs`); a path that is not one of them is refused. If you
want a one-command install for your own vault, add a **new** entry rather than
editing `smoke` — replacing `smoke` would point the maintainer's test command at
your vault, and an entry with `productive: false` deploys with no confirmation
step and no backup. Deployment installs those three files and never writes
`data.json`.

### 📝 Commit Message Guidelines

Use conventional commit format:

- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `style:` for formatting changes
- `refactor:` for code refactoring
- `test:` for adding tests
- `chore:` for maintenance tasks

### 🎯 Areas That Need Help

- 🌍 **Translations**: Help translate to more languages
- 🧪 **Testing**: Add unit tests and integration tests
- 📖 **Documentation**: Improve guides and examples
- 🎨 **UI/UX**: Enhance the user interface
- 🔧 **Performance**: Optimize code and reduce bundle size

### 📞 Contact

- **GitHub Issues**: [Report bugs or request features](https://github.com/MaxLaska/dynamic-action-panel/issues)
- **Questions and ideas**: [Open an issue](https://github.com/MaxLaska/dynamic-action-panel/issues)
