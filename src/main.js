import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { installEarthSpin } from './ui/earthSpin.js';

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

application.start().then(({ scene }) => {
  const cleanupSpin = installEarthSpin(scene.viewer);
  let unsubscribe = () => {};
  unsubscribe = application.subscribe(({ status }) => {
    if (status === 'destroying' || status === 'destroyed' || status === 'failed') {
      cleanupSpin();
      unsubscribe();
    }
  });
}).catch((error) => {
  console.error("God's Eye View initialization failed:", error);
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  loaderStatus.textContent = `Error: ${describeError(error)}`;
  loaderStatus.style.color = '#ff4444';
});

export { application };
