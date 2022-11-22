//
//  NodeRunner.m
//  testnode
//

#include "NodeRunner.hpp"
#include <NodeMobile/NodeMobile.h>
#include <string>

@implementation NodeRunner

+ (void) CopyTestDir:(NSString*)srcTestsPath:(NSString*)dstTestsPath
{
    BOOL isDir;
    if ([[NSFileManager defaultManager] fileExistsAtPath:dstTestsPath isDirectory:&isDir] && isDir) {
        [[NSFileManager defaultManager] removeItemAtPath:dstTestsPath error:nil];
    }
    
    NSLog(@"Copying test files to documents...");
    NSError *copyError = nil;
    if (![[NSFileManager defaultManager] copyItemAtPath:srcTestsPath toPath:dstTestsPath error:&copyError]) {
        NSLog(@"Error copying files: %@", [copyError localizedDescription]);
        exit(1);
    }
}

//node's libUV requires all arguments being on contiguous memory.
+ (int) startEngineWithArguments:(NSArray*)arguments
{
    //Set the builtin_modules path to NODE_PATH

    int c_arguments_size=0;
    
    //Compute byte size need for all arguments in contiguous memory.
    for (id argElement in arguments)
    {
        c_arguments_size+=strlen([argElement UTF8String]);
        c_arguments_size++; // for '\0'
    }
    
    //Stores arguments in contiguous memory.
    char* args_buffer=(char*)calloc(c_arguments_size, sizeof(char));
    
    //argv to pass into node.
    char* argv[[arguments count]];
    
    //To iterate through the expected start position of each argument in args_buffer.
    char* current_args_position=args_buffer;
    
    //Argc
    int argument_count=0;
    
    //Populate the args_buffer and argv.
    for (id argElement in arguments)
    {
        const char* current_argument=[argElement UTF8String];
        
        //Copy current argument to its expected position in args_buffer
        strncpy(current_args_position, current_argument, strlen(current_argument));
        
        //Save current argument start position in argv and increment argc.
        argv[argument_count]=current_args_position;
        argument_count++;
        
        //Increment to the next argument's expected position.
        current_args_position+=strlen(current_args_position)+1;
    }
    //Start node, with argc and argv.
    return node_start(argument_count,argv);
}

@end
