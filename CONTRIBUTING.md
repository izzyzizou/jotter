# Contributing to Jotter

Thanks for helping out! Bug reports, ideas and pull requests are all welcome.

## Getting started

You need Node.js 20.19 or newer.

```bash
npm ci
npm run dev      # start the app at http://localhost:5173
```

The app works without any setup and saves notes in the browser. To try cloud sync, copy `.env.example` to `.env.local` and fill in your own Firebase values (see the README). Never commit `.env.local` or any keys.

## Making a change

1. Fork the repo and create a branch from `main`.
2. Keep the change small and focused, and match the style of the surrounding code.
3. Add or update tests in `test/` when you change behavior.
4. Check that everything passes:

   ```bash
   npm test
   npm run build
   ```

5. Open a pull request against `main` and describe what changed and why.

`main` is protected: changes land through pull requests, and CI (`npm test` and `npm run build`) must pass before merging.

## Reporting bugs

Open an issue with the steps to reproduce, what you expected, what happened, and your browser. Please don't include personal notes or credentials.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
