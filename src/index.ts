import {blue, red, bgYellow} from 'colors';
import {debounce} from 'lodash';
import fastFolderSize from 'fast-folder-size';
import {promisify} from 'util';
import {resolve} from 'path';

const fastFolderSizeAsync = promisify(fastFolderSize);

type MonitoringOptions = {
  MEMORY_WARNING_MAX_SIZE?: number;
  MEMORY_ERROR_MAX_SIZE?: number;
  BUNDLE_ROOT_FOLDER_PATH?: string;
  BUNDLE_MAX_SIZE?: number;
  NODE_MODULES_MAX_SIZE?: number;
  NB_NODE_MODULES_MAX?: number;
  INTERVAL_CHECK_MEMORY?: number;
};

/**
 * Monitor your production build compilation
 * Will show most of infos after writeBundle hooks, that means after files wrote on disk
 * All size are in MB
 * Path of bundle folder can be customized default is ./public/build
 * @param options
 */
export default function monitoring(options: MonitoringOptions = {}): Plugin {
  const {
    MEMORY_WARNING_MAX_SIZE = 2950,
    MEMORY_ERROR_MAX_SIZE = 4500,
    BUNDLE_ROOT_FOLDER_PATH = './public/build',
    BUNDLE_MAX_SIZE,
    NODE_MODULES_MAX_SIZE,
    NB_NODE_MODULES_MAX,
    INTERVAL_CHECK_MEMORY = 350,
  } = options;

  if (MEMORY_WARNING_MAX_SIZE > MEMORY_ERROR_MAX_SIZE) {
    console.error(
      red(
        '\n MEMORY_WARNING_MAX_SIZE value should be lower than  MEMORY_ERROR_MAX_SIZE'
      )
    );
  }

  const infos = checkMemoryUsage({
    MEMORY_WARNING_MAX_SIZE,
    MEMORY_ERROR_MAX_SIZE,
    INTERVAL_CHECK_MEMORY,
  });
  checkNbOfNodeModulesDeps(NB_NODE_MODULES_MAX);

  const finalCallback = async () => {
    clearInterval(infos.interval); // keep the reference of infos , props are updated
    console.log(
      blue(
        `\nMax memory consumption: ${infos.tmpMaxMemoryConsumption}MB at ${infos.dateMaxMemoryConsumption}\n`
      )
    );
    //doing those check in async for I/O perf
    const [bundleMB, nodeModuleMB] = (
      await Promise.all([
        fastFolderSizeAsync(BUNDLE_ROOT_FOLDER_PATH),
        fastFolderSizeAsync('./node_modules'),
      ])
    ).map(toMB);

    checkNodeModulesSize({nodeModuleMB, NODE_MODULES_MAX_SIZE});
    checkBundleSizes({bundleMB, BUNDLE_MAX_SIZE});
  };

  return {
    name: 'monitoring',
    //@ts-expect-error Plugin type for old vite version seems conflicting, using node Plugin type
    enforce: 'pre',
    apply: 'build',
    writeBundle: finalCallback,
  };
}

/**
 * This function is outside because it's debounced by 2500
 * To prevent too much output message when memory go out of limit
 */
const warningMemoryLimit = debounce(
  (memUsage: number, MEMORY_WARNING_MAX_SIZE: number) =>
    console.log(
      bgYellow(
        `\nMEMORY_WARNING_MAX_SIZE option has been reached, memory used is ${memUsage}MB/${MEMORY_WARNING_MAX_SIZE}MB at ${new Date()}\n`
      )
    ),
  2500,
  {leading: true, trailing: true} // Will show the first and last out of memory limit warning
);
/**
 * Function that will check memory of bundle files and node_modules
 * If not value set, they will be shown at the end of the compilation but limit will be undefined
 */
export function checkNodeModulesSize({
  NODE_MODULES_MAX_SIZE,
  nodeModuleMB,
}: {
  NODE_MODULES_MAX_SIZE: number;
  nodeModuleMB: number;
}) {
  if (NODE_MODULES_MAX_SIZE && nodeModuleMB > NODE_MODULES_MAX_SIZE) {
    console.error(
      red(
        `\nNode modules deps size is about ${nodeModuleMB}MB exedeed ${NODE_MODULES_MAX_SIZE}MB\n`
      )
    );
  } else {
    console.log(
      blue(
        `\nNode modules deps size is about ${nodeModuleMB}MB, limit is ${NODE_MODULES_MAX_SIZE}MB\n`
      )
    );
  }
}

export function checkBundleSizes({
  BUNDLE_MAX_SIZE,
  bundleMB,
}: {
  BUNDLE_MAX_SIZE: number;
  bundleMB: number;
}) {
  if (BUNDLE_MAX_SIZE && bundleMB > BUNDLE_MAX_SIZE) {
    console.error(
      red(`\nBundle size is about ${bundleMB}MB exedeed ${BUNDLE_MAX_SIZE}MB\n`)
    );
  } else {
    console.log(
      blue(
        `\nBundle size is about ${bundleMB}MB, limit is ${BUNDLE_MAX_SIZE}MB\n`
      )
    );
  }
}

/**
 * Loop to check memory usage of vite process and subprocesses.
 */
export function checkMemoryUsage({
  MEMORY_WARNING_MAX_SIZE,
  MEMORY_ERROR_MAX_SIZE,
  INTERVAL_CHECK_MEMORY,
}: Partial<MonitoringOptions>) {
  const infos = {
    interval: null,
    tmpMaxMemoryConsumption: 0,
    dateMaxMemoryConsumption: new Date(),
  };
  infos.interval = setInterval(async () => {
    //@ts-expect-error rss exists !
    const memUsage = toMB(process.memoryUsage.rss()); // directly get rss is faster than the top function
    if (memUsage > MEMORY_ERROR_MAX_SIZE) {
      console.error(
        red(
          `\nMEMORY_ERROR_MAX_SIZE option has been reached, memory used is ${memUsage}/${MEMORY_ERROR_MAX_SIZE} at ${new Date()}, killing vite\n`
        )
      );
      // eslint-disable-next-line no-process-exit
      process.exit(1);
    }
    if (memUsage > MEMORY_WARNING_MAX_SIZE) {
      warningMemoryLimit(memUsage, MEMORY_WARNING_MAX_SIZE);
    }

    if (memUsage > infos.tmpMaxMemoryConsumption) {
      infos.tmpMaxMemoryConsumption = memUsage;
      infos.dateMaxMemoryConsumption = new Date();
    }
  }, INTERVAL_CHECK_MEMORY);
  return infos; // keep an object to have reference to data in other function
}

export async function checkNbOfNodeModulesDeps(NB_NODE_MODULES_MAX?: number) {
  if (!NB_NODE_MODULES_MAX) {
    return;
  }
  const appRoot = process.cwd(); //?
  const packageJson = await import(resolve(appRoot, './package.json'));
  const nbOfNodeModulesDeps =
    Object.keys(packageJson.dependencies ?? {}).length +
    Object.keys(packageJson.devDependencies ?? {}).length;

  if (nbOfNodeModulesDeps > NB_NODE_MODULES_MAX) {
    console.error(
      red(
        `\nToo many node modules installed, ${nbOfNodeModulesDeps}/${NB_NODE_MODULES_MAX} did you add some ?\n`
      )
    );
  }
}

/**
 * Convert bytes to MB (not MiB) and fixed of 2
 * @param bytes number, to be converted into MB
 */
export function toMB(bytes: number) {
  return Number((bytes / 1000 / 1000).toFixed(2));
}
