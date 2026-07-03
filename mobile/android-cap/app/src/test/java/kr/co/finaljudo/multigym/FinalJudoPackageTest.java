package kr.co.finaljudo.multigym;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class FinalJudoPackageTest {

    @Test
    public void testPackageIsFinalJudoPackage() {
        assertEquals("kr.co.finaljudo.multigym", FinalJudoPackageTest.class.getPackage().getName());
    }
}
