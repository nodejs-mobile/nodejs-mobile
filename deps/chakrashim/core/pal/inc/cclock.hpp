//-------------------------------------------------------------------------------------------------------
// Copyright (C) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE.txt file in the project root for full license information.
//-------------------------------------------------------------------------------------------------------

#ifndef CC_PAL_INC_CCLOCK_H
#define CC_PAL_INC_CCLOCK_H

class CCLock
{
#if defined(__IOS__) && defined(_ARM64_)
    // NOTE: This will later on be cast and used as a pthread_mutex_t*,
    // which needs to be 8 byte-aligned for ARM64 on iOS.
    char           mutexPtr[64] __attribute__ ((aligned (8)));
#else
    char           mutexPtr[64]; // keep mutex implementation opaque to consumer (PAL vs non-PAL)
#endif

public:
    void Reset(bool shouldTrackThreadId = false);
    CCLock(bool shouldTrackThreadId = false)
    {
        *((size_t*)mutexPtr) = 0;
        Reset(shouldTrackThreadId);
    }

    ~CCLock();

    void Enter();
    bool TryEnter();
    void Leave();
    bool IsLocked() const;
};

#endif // CC_PAL_INC_CCLOCK_H
