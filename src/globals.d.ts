interface ExtendableEvent extends Event {}

type Args = any[];

interface DeviceOrientationEvent extends Event {
  webkitCompassHeading?: number;
}

declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
  }

  export function registerSW(options?: RegisterSWOptions): void;
}
