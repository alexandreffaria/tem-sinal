// Both repository lists search Google's mirror of Maven Central right after Maven Central.
// Maven Central sometimes answers 404 for artifacts it has, and Gradle takes a 404 as "not in this
// repository" without retrying, so the build fails; with the mirror next, Gradle finds them there.
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        maven("https://maven-central.storage-download.googleapis.com/maven2/")
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven("https://maven-central.storage-download.googleapis.com/maven2/")
    }
}

rootProject.name = "CellSignalMapper"
include(":app")
