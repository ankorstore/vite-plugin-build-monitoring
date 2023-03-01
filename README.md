# vite-plugin-build-monitoring
Monitor ram Memory when building, bundle sizing output and node_modules sizing
Ideal for CI Checks and warning

![Capture d’écran 2023-02-28 à 12 02 30](https://user-images.githubusercontent.com/7901366/222119515-3abc943a-3743-422e-8aca-1c6f161b32bf.png)


## Install

`npm install vite-plugin-build-monitoring`

## Usage

```typescript
import monitorPlugin from 'vite-plugin-build-monitoring';

// configure it

const monitor = monitoring({
    BUNDLE_MAX_SIZE: 12,
    NB_NODE_MODULES_MAX: 148,
    MEMORY_WARNING_MAX_SIZE: 2500,
    NODE_MODULES_MAX_SIZE: 1000,
    MEMORY_ERROR_MAX_SIZE: 3000,
  }),

// then add in the plugin list of vite
{
  plugins: [monitor]
}
```


## options

- `BUNDLE_MAX_SIZE` : will check the output folder size, good to prevent regression on bundle size (it takes all the files in output folder to calculate), default is `public/build`  (MB)
- `NB_NODE_MODULES_MAX` : will check the number of prod and dev dependencies you have, show an error if you are above
- `MEMORY_WARNING_MAX_SIZE`: will show a warning if the memory usage while building go higher than the value (MB) 
- `MEMORY_ERROR_MAX_SIZE`: will force vite to stop if the memory go higher than the value, preventing CI to be too long when memoery is growing (MB) 
- `NODE_MODULES_MAX_SIZE`: will show a warning if the disk usage of `node_modules`is higher than the value (MB) 
