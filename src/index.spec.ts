/* eslint-disable no-global-assign */
import {
  toMB,
  checkMemoryUsage,
  checkNodeModulesSize,
  checkBundleSizes,
  checkNbOfNodeModulesDeps,
} from './index';
import {resolve} from 'path';
describe('All Unit function should pass', () => {
  it('Should correctly convert bytes to MB and limit to 2 after comma', () => {
    expect(toMB(20_000)).toBe(0.02);
    expect(toMB(12_345_678)).toBe(12.35);
  });
  it('Should show an error if bundle size is above the limit', () => {
    //@ts-expect-error, we want to modify the global process
    process = {
      env: {
        MONITORING_LOG_ENABLED: 'true',
      },
    };
    const errorSpy = jest.spyOn(console, 'error');
    // I assume two is a variable? If not then don't forget to double quote like "two"
    checkBundleSizes({BUNDLE_MAX_SIZE: 10, bundleMB: 12});
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Bundle size is about 12MB exedeed 10MB')
    );
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Node modules')
    ); //check if console is cleared between tests
  });
  it('Should show an error if node modules size is above a limit', () => {
    const errorSpy = jest.spyOn(console, 'error');
    // I assume two is a variable? If not then don't forget to double quote like "two"
    checkNodeModulesSize({nodeModuleMB: 1000, NODE_MODULES_MAX_SIZE: 900});
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Node modules deps size is about 1000MB exedeed 900'
      )
    );
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Bundle size')
    );
  });
  it('Should show an error in stderr if module deps quantity is higher than the limit', async () => {
    //@ts-expect-error, we want to modify the global process
    process = {
      env: {
        MONITORING_LOG_ENABLED: 'true',
      },
      cwd: () => '123',
    };
    const spy = jest.spyOn(process, 'cwd');
    const logSpy = jest.spyOn(console, 'error');
    const appRoot = resolve(__dirname, '../');
    spy.mockReturnValue(appRoot);
    await checkNbOfNodeModulesDeps(10);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Too many node modules installed')
    );
  });
  it('Should output a warning if memory usage is higher than expected', async () => {
    process.memoryUsage = {
      //@ts-expect-error  is needed for test runing with ts-jest
      rss() {
        return 150000000; //150MB
      },
    };
    jest.useFakeTimers();
    const logSpy = jest.spyOn(console, 'log');
    checkMemoryUsage({
      MEMORY_WARNING_MAX_SIZE: 100,
      MEMORY_ERROR_MAX_SIZE: 1500,
    });
    jest.advanceTimersByTime(5000);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'MEMORY_WARNING_MAX_SIZE option has been reached, memory used is 150MB/100MB'
      )
    );
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Bundle'));
  });
  it('Should output an error and kill process if memory usage is way higher than expected', async () => {
    // eslint-disable-next-line no-global-assign
    process = {
      env: {
        MONITORING_LOG_ENABLED: 'true',
      },
      memoryUsage: {
        //@ts-expect-error  is needed for test runing with ts-jest
        rss() {
          return 1500000000; //1500MB
        },
      },
      //@ts-expect-error  is needed for test runing with ts-jest
      exit: (code?: number) => {
        return code;
      },
    };
    jest.useFakeTimers();
    const errorSpy = jest.spyOn(console, 'error');
    const processExitSpy = jest.spyOn(process, 'exit');
    checkMemoryUsage({
      MEMORY_WARNING_MAX_SIZE: 100,
      MEMORY_ERROR_MAX_SIZE: 1000,
    });
    jest.advanceTimersByTime(5000);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('MEMORY_ERROR_MAX_SIZE option has been reached')
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(processExitSpy).not.toHaveBeenCalledWith(0);
  });
});
