import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "apps/lab-web/tests",
  webServer: {
    command: "npm run dev -w @liquid/lab-web -- --host 127.0.0.1",
    reuseExistingServer: !process.env.CI,
    url: "http://127.0.0.1:5173",
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
