import {red, bgYellow, Color, green} from 'colors';
import {debounce} from 'lodash';
import fastFolderSize from 'fast-folder-size';
import {promisify} from 'util';
import {resolve} from 'path';
import {Subject} from 'rxjs';

const fastFolderSizeAsync = promisify(fastFolderSize);

type MonitoringOptions = {
  MEMORY_WARNING_MAX_SIZE?: number;
  MEMORY_ERROR_MAX_SIZE?: number;
  BUNDLE_ROOT_FOLDER_PATH?: string;
  BUNDLE_MAX_SIZE?: number;
  NODE_MODULES_MAX_SIZE?: number;
  NB_NODE_MODULES_MAX?: number;
  INTERVAL_CHECK_MEMORY?: number;
  LOG?: boolean;
};

type checksObservables = {
  error?: string;
  warning?: string;
  info?: string;
};

// Usefull to share data with the program which will use the plugin
export const subject = new Subject<checksObservables>();

// specialized functions for loggin
const colorizedLog =
  (
    colorFn: Color,
    type: keyof Pick<Console, 'log' | 'info' | 'error' | 'warn'>
  ) =>
  (text: string) =>
    process.env.MONITORING_LOG_ENABLED ? console[type](colorFn(text)) : void 0;
const errorLog = colorizedLog(red, 'error');
const warningLog = colorizedLog(bgYellow, 'log');
const infoLog = colorizedLog(green, 'log');

/**
 * TXT messages about memory
 */
const WARNING_ABOVE_ERROR_TXT =
  '\n MEMORY_WARNING_MAX_SIZE value should be lower than  MEMORY_ERROR_MAX_SIZE';
const MEMORY_CONSUMPTION_TXT = (
  maxMemoryConsumption: number,
  dateMaxMemoryConsumption: Date
) =>
  `\nMax memory consumption: ${maxMemoryConsumption}MB at ${dateMaxMemoryConsumption}\n`;
const WARNING_MEMORY_CONSUMPTION_TXT = (
  memUsage: number,
  MEMORY_WARNING_MAX_SIZE: number
) =>
  `\nMEMORY_WARNING_MAX_SIZE option has been reached, memory used is ${memUsage}MB/${MEMORY_WARNING_MAX_SIZE}MB at ${new Date()}\n`;

const ERROR_MEMORY_CONSUMPTION_TXT = (
  memUsage: number,
  MEMORY_ERROR_MAX_SIZE: number
) =>
  `\nMEMORY_ERROR_MAX_SIZE option has been reached, memory used is ${memUsage}/${MEMORY_ERROR_MAX_SIZE} at ${new Date()}, killing vite\n`;
/**
 *
 *TXT messages about NODE_MODULES
 */
const ERROR_NODE_MODULE_SIZE_TXT = (
  nodeModuleMB: number,
  NODE_MODULES_MAX_SIZE
) =>
  `\nNode modules deps size is about ${nodeModuleMB}MB exedeed ${NODE_MODULES_MAX_SIZE}MB\n`;
const INFO_NODE_MODULE_SIZE_TXT = (
  nodeModuleMB: number,
  NODE_MODULES_MAX_SIZE
) =>
  `\nNode modules deps size is about ${nodeModuleMB}MB, limit is ${NODE_MODULES_MAX_SIZE}MB\n`;

const ERROR_NODE_MODULE_NB_TXT = (
  nbOfNodeModulesDeps: number,
  NB_NODE_MODULES_MAX: number
) =>
  `\nToo many node modules installed, ${nbOfNodeModulesDeps}/${NB_NODE_MODULES_MAX} did you add some ?\n`;
const INFO_NODE_MODULE_NB_TXT = (
  nbOfNodeModulesDeps: number,
  NB_NODE_MODULES_MAX: number
) =>
  `\nNb of node modules installed is, ${nbOfNodeModulesDeps}/${NB_NODE_MODULES_MAX} (max)\n`;

/**
 * TXT messages about Bundle
 */
const ERROR_BUNDLE_SIZE_TXT = (bundleMB: number, BUNDLE_MAX_SIZE: number) =>
  `\nBundle size is about ${bundleMB}MB exedeed ${BUNDLE_MAX_SIZE}MB\n`;
const INFO_BUNDLE_SIZE_TXT = (bundleMB: number, BUNDLE_MAX_SIZE: number) =>
  `\nBundle size is about ${bundleMB}MB, limit is ${BUNDLE_MAX_SIZE}MB\n`;
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
    LOG = true,
  } = options;

  if (LOG) {
    process.env.MONITORING_LOG_ENABLED = 'true';
  }

  if (MEMORY_WARNING_MAX_SIZE > MEMORY_ERROR_MAX_SIZE) {
    subject.next({error: WARNING_ABOVE_ERROR_TXT});
    errorLog(WARNING_ABOVE_ERROR_TXT);
  }

  const infos = checkMemoryUsage({
    MEMORY_WARNING_MAX_SIZE,
    MEMORY_ERROR_MAX_SIZE,
    INTERVAL_CHECK_MEMORY,
  });
  checkNbOfNodeModulesDeps(NB_NODE_MODULES_MAX);

  const finalCallback = async () => {
    clearInterval(infos.interval); // keep the reference of infos , props are updated
    const info = MEMORY_CONSUMPTION_TXT(
      infos.tmpMaxMemoryConsumption,
      infos.dateMaxMemoryConsumption
    );
    subject.next({info});
    infoLog(info);

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
  (memUsage: number, MEMORY_WARNING_MAX_SIZE: number) => {
    const warning = WARNING_MEMORY_CONSUMPTION_TXT(
      memUsage,
      MEMORY_WARNING_MAX_SIZE
    );
    subject.next({
      warning,
    });
    warningLog(warning);
  },
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
    const error = ERROR_NODE_MODULE_SIZE_TXT(
      nodeModuleMB,
      NODE_MODULES_MAX_SIZE
    );
    subject.next({
      error,
    });
    errorLog(error);
  } else {
    const info = INFO_NODE_MODULE_SIZE_TXT(nodeModuleMB, NODE_MODULES_MAX_SIZE);
    subject.next({
      info,
    });
    infoLog(info);
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
    const error = ERROR_BUNDLE_SIZE_TXT(bundleMB, BUNDLE_MAX_SIZE);
    subject.next({
      error,
    });
    errorLog(error);
  } else {
    const info = INFO_BUNDLE_SIZE_TXT(bundleMB, BUNDLE_MAX_SIZE);
    subject.next({
      info,
    });
    infoLog(info);
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
      const error = ERROR_MEMORY_CONSUMPTION_TXT(
        memUsage,
        MEMORY_ERROR_MAX_SIZE
      );
      subject.next({
        error,
      });
      errorLog(error);
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
  const appRoot = process.cwd();
  const packageJson = await import(resolve(appRoot, './package.json'));
  const nbOfNodeModulesDeps =
    Object.keys(packageJson.dependencies ?? {}).length +
    Object.keys(packageJson.devDependencies ?? {}).length;

  if (nbOfNodeModulesDeps > NB_NODE_MODULES_MAX) {
    const error = ERROR_NODE_MODULE_NB_TXT(
      nbOfNodeModulesDeps,
      NB_NODE_MODULES_MAX
    );
    subject.next({
      error,
    });
    errorLog(error);
  } else {
    const info = INFO_NODE_MODULE_NB_TXT(
      nbOfNodeModulesDeps,
      NB_NODE_MODULES_MAX
    );
    subject.next({
      info,
    });
    infoLog(info);
  }
}

/**
 * Convert bytes to MB (not MiB) and fixed of 2
 * @param bytes number, to be converted into MB
 */
export function toMB(bytes: number) {
  return Number((bytes / 1000 / 1000).toFixed(2));
}
