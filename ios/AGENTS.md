# DocVault iOS

Root privacy instructions apply here. Use invented fixtures only. Never commit
server URLs, credentials, household documents, real account data, signing keys,
or screenshots from a real vault.

- Native SwiftUI, Swift 6, iOS 26+, iPhone and iPad. No web code lives here.
- Edit `project.yml`, then `make generate`; the Xcode project is generated.
- Run `make test`. Keep simulator ad-hoc signing enabled for Keychain access.
- Use `make demo SIMID=<booted simulator UUID>` for invented records and screenshots.
- `Config/Signing.xcconfig` is private and ignored; the example contains no real team.
- Native networking uses the existing Bun API, not a second backend. Endpoint
  contracts live in `../web/server/`. WebKit uses the same session and an ephemeral store.
- Every sheet must retain privacy protection while locked or backgrounded.
- The integration fixture in `../web/tools/ios-ui-fixture.ts` uses temporary
  synthetic data. Do not start the user's development server or use real NAS data
  for UI tests. Never publish, upload, or submit the app without user authorization.
