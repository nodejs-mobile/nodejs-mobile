// -------------------------------------------------------------------------------------------------------
// Copyright (C) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE.txt file in the project root for full license information.
// Modified by Janea Systems for iOS build.
// -------------------------------------------------------------------------------------------------------

#include "unixasmmacros.inc"

// .thumb
.global C_FUNC(_ZN2Js18JavascriptFunction24DeferredDeserializeThunkEPNS_16RecyclableObjectENS_8CallInfoEz)
.global C_FUNC(_ZN2Js18JavascriptFunction20DeferredParsingThunkEPNS_16RecyclableObjectENS_8CallInfoEz)
// .arm
.global C_FUNC(arm64_CallFunction)
.global C_FUNC(arm64_CallEhFrame)
.global C_FUNC(arm64_CallCatch)

NESTED_ENTRY _ZN2Js18JavascriptFunction24DeferredDeserializeThunkEPNS_16RecyclableObjectENS_8CallInfoEz, _TEXT, NoHandler

    PROLOG_SAVE_REG_PAIR_INDEXED fp, lr, -80  // save parameter registers
    stp     x0, x1, [sp, 16]
    stp     x2, x3, [sp, 32]
    stp     x4, x5, [sp, 48]
    stp     x6, x7, [sp, 64]

    bl      __ZN2Js18JavascriptFunction19DeferredDeserializeEPNS_14ScriptFunctionE // retrieve entrypoint
    mov     x16, x0                     // back up entryPoint in x16

    ldp     x6, x7, [sp, 64]
    ldp     x4, x5, [sp, 48]
    ldp     x2, x3, [sp, 32]
    ldp     x0, x1, [sp, 16]
    EPILOG_RESTORE_REG_PAIR_INDEXED fp, lr, 80
    br x16                   // tail call to new entryPoint

NESTED_END _ZN2Js18JavascriptFunction24DeferredDeserializeThunkEPNS_16RecyclableObjectENS_8CallInfoEz, _TEXT

NESTED_ENTRY _ZN2Js18JavascriptFunction20DeferredParsingThunkEPNS_16RecyclableObjectENS_8CallInfoEz, _TEXT, NoHandler

    PROLOG_SAVE_REG_PAIR_INDEXED fp, lr, -80
    stp     x0, x1, [sp, 16]
    stp     x2, x3, [sp, 32]
    stp     x4, x5, [sp, 48]
    stp     x6, x7, [sp, 64]

    // Pass the address of the function at the saved x0
    mov     x0, sp
    add     x0, x0, 16
    bl      __ZN2Js18JavascriptFunction13DeferredParseEPPNS_14ScriptFunctionE // retrieve entrypoint
    mov     x16, x0                             // back up entryPoint in x16

    ldp     x6, x7, [sp, 64]
    ldp     x4, x5, [sp, 48]
    ldp     x2, x3, [sp, 32]
    ldp     x0, x1, [sp, 16]
    EPILOG_RESTORE_REG_PAIR_INDEXED fp, lr, 80
    br x16                   // tail call to new entryPoint

NESTED_END _ZN2Js18JavascriptFunction20DeferredParsingThunkEPNS_16RecyclableObjectENS_8CallInfoEz, _TEXT

NESTED_ENTRY arm64_CallFunction, _TEXT, NoHandler

    stp    fp, lr, [sp, -16]!                   // save fp/lr
    mov    fp, sp                               // explicitly save sp in fp
    // CFI directives that work well in both Apple's armv8-a and armv8.3-a runtimes
    .cfi_def_cfa x29, 16
    .cfi_offset x30, -8
    .cfi_offset x29, -16

    mov     x8, x4                              // copy entry point to x8
    mov     x9, x3                              // copy values pointer to x9

    #if _CONTROL_FLOW_GUARD
    mov     x15, x4                             // __guard_check_icall_fptr requires the call target in x15
    adrp    x16, __guard_check_icall_fptr       //
    ldr     x16, [x16, __guard_check_icall_fptr]// fetch address of guard check handler
    blr     x16                                 // call it
    #endif

    #ifdef __IOS__
    // On iOS arm64, variadic parameters go straight to the stack,
    // so we want to skip right ahead to allocating stack space for the parameters.
    subs    x5, x2, 0
    #else //__IOS__
    subs    x5, x2, 6                           // more than 6 parameters?
    #endif //__IOS__
    bgt     LOCAL_LABEL(StackAlloc)             // if so, allocate necessary stack

    adr     x5, LOCAL_LABEL(CopyZero)           // get bottom of parameter copy loop
    sub     x5, x5, x2, lsl 2                   // compute address of where to start
    br      x5                                  // branch there
LOCAL_LABEL(CopyAll):
    ldr     x7, [x9, 40]                        // load remaining 6 registers here
    ldr     x6, [x9, 32]                        //
    ldr     x5, [x9, 24]                        //
    ldr     x4, [x9, 16]                        //
    ldr     x3, [x9, 8]                         //
    ldr     x2, [x9, 0]                         //
LOCAL_LABEL(CopyZero):
    blr     x8                                  // call saved entry point

    mov     sp, fp                              // explicitly restore sp
    ldp     fp, lr, [sp], 16                    // restore fp/lr
    EPILOG_RETURN                               // return

LOCAL_LABEL(StackAlloc):
    #ifdef __IOS__
    // On iOS variadic parameters go straight to the stack.
    // This also copying x0 (JavaScriptFunction) and x1 (CallInfo), according
    // to the ChakraCore Engine custom ABI. So we add 2 to allocate space for
    // 2 more arguments and 1 to round the final stack pointer to a 16
    // aligned position.
    add     x15, x5, 3                         // round (param_count+1) up by 1
    #else //__IOS__
    add     x15, x5, 1                         // round (param_count - 6) up by 1
    #endif //__IOS__
    lsr     x15, x15, 1                        // divide by 2

    //bl      __chkstk                         // ensure stack is allocated
    // xplat-todo: need to have an equivalent function to __chkstk that we can
    // call here to verify that we have enough stack space

    sub     sp, sp, x15, lsl 4                 // then allocate the space
    #ifdef __IOS__
    //On iOS variadic parameters go straight to the stack, including x0 and x1
    // x3 already contains the source for copying
    mov     x4, sp                             // use x4 = dest
    str     x0, [x4], 8                        // store x0 to dest
    str     x1, [x4], 8                        // store x1 to dest
    #else //__IOS__
    add     x3, x3, 48                         // use x3 = source
    mov     x4, sp                             // use x4 = dest
    #endif //__IOS__

LOCAL_LABEL(CopyLoop):
    subs    x5, x5, 1                          // decrement param count by 1
    ldr     x7, [x3], 8                        // read param from source
    str     x7, [x4], 8                        // store param to dest
    bne     LOCAL_LABEL(CopyLoop)              // loop until all copied
    #ifdef __IOS__
    //On iOS variadic parameters go straight to the stack.
    b       LOCAL_LABEL(CopyZero)              // jump ahead to function call
    #else //__IOS__
    b       LOCAL_LABEL(CopyAll)               // jump ahead to copy all 6 remaining parameters
    #endif //__IOS__

NESTED_END arm64_CallFunction, _TEXT

NESTED_ENTRY BreakSpeculation, _TEXT, NoHandler
cmp x0, x0
csel x0, x0, x0, EQ
ret
NESTED_END, _TEXT

NESTED_ENTRY arm64_CallEhFrame, _TEXT, NoHandler
//FIXME: Shouldn't be called without JIT, but is linking.
NOP
NESTED_END arm64_CallEhFrame, _TEXT

NESTED_ENTRY arm64_CallCatch, _TEXT, NoHandler
//FIXME: Shouldn't be called without JIT, but is linking.
NOP
NESTED_END arm64_CallCatch, _TEXT
