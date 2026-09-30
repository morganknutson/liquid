# @liquid/addy-logo

The animated Addy logo for websites: four ticks drop into the pill and flow into the Addy wordmark. It is framework-agnostic and depends only on `@liquid/web` and `@liquid/scenes`.

```ts
import { defineAddyLogoElement } from "@liquid/addy-logo";
defineAddyLogoElement();
```

```html
<addy-logo style="width: 320px">
  <img src="/addy-logo.svg" alt="Addy" />
</addy-logo>
```

Or imperatively:

```ts
import { mountAddyLogo } from "@liquid/addy-logo";

const logo = mountAddyLogo(container, { autoplay: "visible", onComplete: () => {} });
// later
logo.destroy();
```

Options, sizing, and behavior are documented in [docs/integration.md](../../docs/integration.md#addy-logo).
