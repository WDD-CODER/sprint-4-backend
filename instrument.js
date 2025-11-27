import * as Sentry from "@sentry/node"

Sentry.init({
  dsn: "https://d84226e37597445deb0febddce71b87e@o4510415035170816.ingest.de.sentry.io/4510437616255056",
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  tracesSampleRate: 1.0,
  sendDefaultPii: true,
});