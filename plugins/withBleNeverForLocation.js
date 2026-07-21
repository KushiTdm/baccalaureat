// plugins/withBleNeverForLocation.js
//
// L'app ne dérive JAMAIS de localisation physique depuis les résultats de
// scan BLE (uniquement pour trouver une partie Petit Bac à proximité) : on
// peut donc déclarer BLUETOOTH_SCAN avec android:usesPermissionFlags=
// "neverForLocation". Sans ce flag, Android 12+ exige que le service de
// localisation soit ACTIVÉ AU NIVEAU SYSTÈME (pas juste la permission
// accordée) pour que le scan retourne des résultats — sinon le scan
// "réussit" silencieusement avec zéro résultat, sans la moindre erreur.
// C'est la cause la plus probable du bug "Aucune partie trouvée" alors que
// l'hôte diffuse bien : la bibliothèque munim-bluetooth ne déclare pas ce
// flag dans son propre plugin, donc on le rajoute ici après coup.
//
// Nécessite un rebuild natif (EAS) pour prendre effet.
const { withAndroidManifest } = require('@expo/config-plugins');

const BLUETOOTH_SCAN = 'android.permission.BLUETOOTH_SCAN';

module.exports = function withBleNeverForLocation(config) {
  return withAndroidManifest(config, (config) => {
    const permissions = config.modResults.manifest['uses-permission'] || [];
    for (const perm of permissions) {
      if (perm.$?.['android:name'] === BLUETOOTH_SCAN) {
        perm.$['android:usesPermissionFlags'] = 'neverForLocation';
      }
    }
    return config;
  });
};
