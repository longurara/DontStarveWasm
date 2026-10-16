// Read-only native-code evidence for the compatible engine. No program execution.
// @category DST.Wasm
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public class DumpFunctions extends GhidraScript {
    @Override public void run() throws Exception {
        String[] arguments=getScriptArgs();
        if(arguments.length<2)throw new IllegalArgumentException("Output directory and function addresses are required");
        Path directory=Path.of(arguments[0]);Files.createDirectories(directory);
        DecompInterface decompiler=new DecompInterface();
        if(!decompiler.openProgram(currentProgram))throw new IllegalStateException(decompiler.getLastMessage());
        try {
            for(int i=1;i<arguments.length;i++){
                Address address=toAddr(arguments[i]);Function function=getFunctionAt(address);
                if(function==null){disassemble(address);function=createFunction(address,null);}
                if(function==null)throw new IllegalStateException("No function at "+address);
                DecompileResults result=decompiler.decompileFunction(function,120,monitor);
                if(!result.decompileCompleted())throw new IllegalStateException("Decompile failed at "+address+": "+result.getErrorMessage());
                String code="// Build 756039, native entry "+address+", function "+function.getName()+"\n"+
                    "// Decompiled evidence; types and behavior must be checked against assembly and native traces.\n"+
                    result.getDecompiledFunction().getC();
                Files.writeString(directory.resolve("fn_"+address.toString()+".c"),code,StandardCharsets.UTF_8);
                println("DST_DECOMPILED "+address+" "+function.getName());
            }
        } finally {decompiler.dispose();}
    }
}
