{
  'defines': [ 'V8_DEPRECATION_WARNINGS=1', 'NODE_WANT_INTERNALS=1' ],
  'conditions': [
    [ 'OS in "linux freebsd openbsd solaris android aix cloudabi"', {
      'cflags': ['-Wno-cast-function-type'],
    }],
  ],
}
