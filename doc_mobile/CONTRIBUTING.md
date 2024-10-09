# Contributing to Node.js for Mobile Apps

## Code Contributions
Only changes that fall within the scope of the [project goals](../README.md#project-goals) will be accepted.

If you want to implement a major feature or a semantical change, please open an issue for discussion first. For minor fixes, feel free to just open a pull request.

### Commit guidelines
Please ensure that commits messages adhere to the [Node.js commit message guidelines](https://github.com/nodejs/node/blob/master/CONTRIBUTING.md#commit-message-guidelines).

Platform-specific fixes for Android or iOS should be implemented in separate commits, and the titles of those commits should include `android` or `ios` in the list of affected subsystems.

<a id="developers-certificate-of-origin"></a>

## Updating nodejs-mobile from upstream nodejs/node

To update the version of node.js used in this project, carefully follow these steps:

1. Suppose the current version in nodejs-mobile is `A.b.c` and the newer version in nodejs/node is `X.y.z`
2. Locally clone the nodejs/node repository
3. `cd` into the nodejs/node repository
4. Create a single commit that squashes all changes from git tag `vA.b.c` to `vX.y.z`
    4.1. `git checkout vX.y.z` to go to the newer version
    4.2. Delete the branch `nodejs-mobile-update` if it exists
    4.3. `git checkout -b nodejs-mobile-update` to create a branch at the newer version
    4.4. `git reset --soft vA.b.c` to reset the branch all the way to the older version
    4.5. `git commit -m "Update node.js to vX.y.z"` to create a single commit with all changes
5. `git format-patch -1 HEAD -o ../` which will create a patch file in the parent directory
6. `cd` into the nodejs-mobile repository
7. Apply the patch file with `git am --3way --ignore-space-change ../0001-Node.js-vA.b.c.patch` (sometimes it may be useful to use the flag `--reject`)
8. Manually resolve git conflicts that may arise

## Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

* (a) The contribution was created in whole or in part by me and I
  have the right to submit it under the open source license
  indicated in the file; or

* (b) The contribution is based upon previous work that, to the best
  of my knowledge, is covered under an appropriate open source
  license and I have the right under that license to submit that
  work with modifications, whether created in whole or in part
  by me, under the same open source license (unless I am
  permitted to submit under a different license), as indicated
  in the file; or

* (c) The contribution was provided directly to me by some other
  person who certified (a), (b) or (c) and I have not modified
  it.

* (d) I understand and agree that this project and the contribution
  are public and that a record of the contribution (including all
  personal information I submit with it, including my sign-off) is
  maintained indefinitely and may be redistributed consistent with
  this project or the open source license(s) involved.
