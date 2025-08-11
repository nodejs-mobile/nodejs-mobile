{
  'variables': {
    'simdutf_sources': [
      'simdutf.cpp',
    ]
  },
  'targets': [
    {
      'target_name': 'simdutf',
      'toolsets': ['host', 'target'],
      'type': 'static_library',
      'include_dirs': ['.'],
      'direct_dependent_settings': {
        'include_dirs': ['.'],
      },
      'sources': [
        '<@(simdutf_sources)',
      ],
      'conditions': [
        [ 'OS=="ios"', {
          'target_conditions': [
            ['_toolset=="host"', {
              'xcode_settings': {
                'SDKROOT': 'macosx',
                'MACOSX_DEPLOYMENT_TARGET': '10.15',
                'IPHONEOS_DEPLOYMENT_TARGET': '',
                'ENABLE_BITCODE': 'NO',
              },
              'cflags!': [
                '-miphoneos-version-min=14.0',
                '-fembed-bitcode',
              ],
              'cflags': [
                '-mmacosx-version-min=10.15',
              ],
              'ldflags!': [
                '-miphoneos-version-min=14.0',
                '-fembed-bitcode',
              ],
              'ldflags': [
                '-mmacosx-version-min=10.15',
              ],
            }],
          ],
        }],
      ],
    },
  ]
}
