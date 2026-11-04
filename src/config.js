module.exports = {
  // "Log in with Nexus" (SSO) needs an application slug that Nexus Mods issues to registered apps
  // (ask their staff via https://www.nexusmods.com — "Register an application").
  // While it is empty the app logs in with a personal API key instead.
  nexusAppSlug: '',

  // GitHub repository ("owner/name") whose Releases carry new versions of the manager.
  // Each release needs the MMC-Mod-Manager-Setup-<version>.exe attached and a tag like v1.3.0.
  updateRepo: 'Lepotion/mmc-mod-manager',
};
