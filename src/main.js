import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { installEarthSpin } from './ui/earthSpin.js';
import { installResilienceLab } from './ui/resilienceLab.js';

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

application.start().then(({ scene, data }) => {
  const cleanupSpin = installEarthSpin(scene.viewer);
  const cleanupLab = installResilienceLab({ viewer: scene.viewer, dataManager: data.dataManager });
  let unsubscribe = () => {};
  unsubscribe = application.subscribe(({ status }) => {
    if (status === 'destroying' || status === 'destroyed' || status === 'failed') {
      cleanupSpin();
      cleanupLab();
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
