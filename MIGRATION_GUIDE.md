# Migration from Original software

This guide helps users transition from the original software to BPM - Escrime, covering data compatibility, feature differences, and migration workflows.

## 📋 Table of Contents

1. [Overview of Changes](#overview-of-changes)
2. [Data Compatibility](#data-compatibility)
3. [Feature Comparison](#feature-comparison)
4. [Migration Workflows](#migration-workflows)
5. [Interface Differences](#interface-differences)
6. [Common Migration Issues](#common-migration-issues)
7. [Learning Resources](#learning-resources)

## 🔄 Overview of Changes

BPM - Escrime is a complete rewrite of the original software using modern web technologies. While maintaining compatibility with core functionality, it introduces significant improvements in user experience, performance, and cross-platform support.

### Key Improvements

| Area | Original software | BPM - Escrime |
|-------|---------------------|-------------------|
| **Technology** | Java-based | Electron + React |
| **Platform Support** | Windows/macOS | Windows/macOS/Linux |
| **User Interface** | Swing UI | Modern React UI |
| **Performance** | Limited by Java | Optimized JavaScript |
| **Remote Scoring** | Basic/Manual | Built-in WebSocket |
| **File Format** | Proprietary | XML + FFF + CSV |
| **Auto-save** | Manual | Automatic (2 min) |
| **Updates** | Manual download | Automatic updates |
| **Mobile Support** | None | Web-based remote scoring |

### Migration Benefits

- **Cross-platform**: Linux support finally available
- **Modern UI**: Intuitive, responsive interface
- **Remote Scoring**: Built-in tablet support without extra software
- **Auto-save**: No more data loss from crashes
- **Performance**: Faster with large competitions
- **Updates**: Automatic with user consent
- **Integration**: Better file format compatibility

## 💾 Data Compatibility

### Supported File Formats

#### Export from Original software

**✅ Fully Compatible**:
- BPM - Escrime XML exports
- FFF files (.fff format)
- CSV files with fencer data
- Competition data with pools and tableaux

**⚠️ Partially Compatible**:
- Binary database files (needs XML export first)
- Custom plugin data
- Historical data (requires XML export)

**❌ Not Directly Compatible**:
- Original software binary files
- Plugin-specific data structures
- Native file formats

### Export Process from Original software

#### Step 1: Export Competition Data

1. **Open Original software**
2. **Load Your Competition**
3. **Export Data**:

```
Original software Menu:
File → Export → XML Competition
File → Export → FFF File
File → Export → CSV Results
```

#### Step 2: Verify Export Files

Check the exported files:
```xml
<!-- Competition XML should look like this -->
<?xml version="1.0" encoding="UTF-8"?>
<Competition Nom="Tournament Name" Arme="Epee" Date="2024-03-15">
  <Tireurs>
    <Tireur Nom="DUPONT" Prenom="Jean" Sexe="M" .../>
  </Tireurs>
  <Phases>
    <Phase Nom="Poules">
      <!-- Pool data -->
    </Phase>
  </Phases>
</Competition>
```

#### Step 3: Import to BPM - Escrime

1. **Open BPM - Escrime**
2. **Create New Competition**
3. **Import Data**:

```
BPM - Escrime:
Competition → Import Fencers → Select XML file
```

### Database Migration

#### If You Only Have Database Files

**Method 1: XML Export (Recommended)**
1. Install original software temporarily
2. Open database files
3. Export each competition to XML
4. Import XML files to BPM - Escrime

**Method 2: Manual Recreation**
1. Export fencer lists to CSV/FFF
2. Note competition settings
3. Recreate competitions in BPM - Escrime
4. Import fencer data

#### Export Multiple Competitions

**Batch Export Script** (if you have many competitions):

```bash
# This would be run with original software automation
# (conceptual - actual script depends on original software capabilities)

for db_file in *.original; do
  original-software --export-xml "$db_file" --output "${db_file%.*}.xml"
done
```

## 🆚 Feature Comparison

### Core Features

| Feature | Original software | BPM - Escrime | Status |
|---------|---------------------|-------------------|---------|
| **Competition Management** | ✅ | ✅ | Enhanced |
| **Fencer Import** | ✅ | ✅ | Enhanced |
| **Pool Generation** | ✅ | ✅ | Enhanced |
| **Tableau Management** | ✅ | ✅ | Enhanced |
| **Score Entry** | ✅ | ✅ | Enhanced |
| **Export Results** | ✅ | ✅ | Enhanced |
| **Auto-save** | ❌ | ✅ | New Feature |
| **Remote Scoring** | ❌/Basic | ✅/Advanced | New Feature |
| **Multi-platform** | Windows/macOS | Win/Mac/Linux | Enhanced |
| **Automatic Updates** | ❌ | ✅ | New Feature |

### Enhanced Features

#### Fencer Import Improvements

**Original**:
- Basic FFF parsing
- Limited format support
- Manual error handling

**BPM - Escrime**:
- Advanced FFF parser with mixed format support
- Handles names with commas (e.g., "LE-FLOCH,JEAN-BAPTISTE")
- Automatic format detection
- Detailed error reporting
- UTF-8 encoding support

#### Remote Scoring

**Original**:
- External plugins required
- Complex setup
- Limited device support

**BPM - Escrime**:
- Built-in web server
- Tablet/phone browser support
- Real-time synchronization
- Simple setup with access codes
- Cross-platform compatibility

#### User Interface

**Original**:
- Java Swing interface
- Traditional desktop app look
- Limited responsiveness

**BPM - Escrime**:
- Modern React interface
- Responsive design
- Intuitive workflows
- Keyboard shortcuts
- Dark/light theme support (future)

## 🛠️ Migration Workflows

### Complete Migration Workflow

#### Phase 1: Preparation

1. **Backup Original Data**
   ```bash
   # Create backup of original software data
   cp -r /path/to/original/data ./backup_$(date +%Y%m%d)
   ```

2. **List Active Competitions**
   - Document ongoing competitions
   - Note special settings or plugins used
   - Identify critical data to migrate first

3. **Install BPM - Escrime**
   - Download latest version
   - Install on test machine first
   - Verify functionality

#### Phase 2: Data Export

1. **Export from Original software**
   
   **For Each Competition**:
   ```
   File → Export → XML Competition → Save as competition_name.xml
   File → Export → FFF File → Save as competition_name.fff
   File → Export → Results → Save as competition_name_results.csv
   ```

2. **Organize Export Files**
   ```
   migration/
   ├── competitions/
   │   ├── regional_2024/
   │   │   ├── competition.xml
   │   │   ├── fencers.fff
   │   │   └── results.csv
   │   └── youth_2024/
   │       └── ...
   └── templates/
       └── competition_template.xml
   ```

3. **Validate Export Files**
   - Check XML is well-formed
   - Verify FFF files are readable
   - Test import with small sample

#### Phase 3: Import to BPM - Escrime

1. **Create Competition Templates**
   - Import one sample competition
   - Configure settings appropriately
   - Save as template for similar competitions

2. **Batch Import Process**
   
   **For Each Competition**:
   1. Create new competition in BPM - Escrime
   2. Import fencers from FFF/XML file
   3. Configure competition settings
   4. Verify data integrity
   5. Test with dummy data

3. **Data Verification**
   - Compare fencer counts
   - Verify rankings calculations
   - Check special cases (byes, withdrawals)
   - Validate pool assignments

#### Phase 4: Testing and Validation

1. **Functional Testing**
   - Run mock competition
   - Test score entry
   - Verify export functionality
   - Test remote scoring

2. **Data Accuracy**
   - Compare calculations with original
   - Verify ranking formulas
   - Check edge cases (ties, withdrawals)

3. **User Acceptance**
   - Train users on new interface
   - Collect feedback
   - Address issues before full rollout

### Step-by-Step Migration Example

#### Example: Migrating Regional Championship

**Step 1: Export from Original**
```
Original software Actions:
1. Open "Championnat Régional 2024"
2. File → Export → XML Competition
3. Save as "regional_2024.xml"
4. File → Export → FFF File  
5. Save as "regional_2024_fencers.fff"
```

**Step 2: Setup in BPM - Escrime**
```
BPM - Escrime Actions:
1. Click "New Competition"
2. Name: "Championnat Régional 2024"
3. Weapon: Épée
4. Gender: Male
5. Date: 2024-03-15
6. Create Competition
```

**Step 3: Import Fencers**
```
1. Go to Fencers tab
2. Click "Import Fencers"
3. Select "regional_2024_fencers.fff"
4. Review import results
5. Confirm import
```

**Step 4: Configure Settings**
```
1. Click "Properties" ⚙️
2. Set competition format:
   - Pool rounds: 1
   - Direct elimination: Enabled
   - Max score pool: 21
   - Max score tableau: 15
3. Save settings
```

**Step 5: Verify Data**
```
1. Check fencer count matches original
2. Verify club assignments
3. Validate ranking positions
4. Test pool generation
```

### Advanced Migration Scenarios

#### Scenario 1: Large Competition (500+ Fencers)

**Challenges**:
- Performance during import
- Memory usage
- Processing time

**Solutions**:
```bash
# Split large FFF files into chunks
split -l 100 large_competition.fff chunk_

# Import chunks sequentially
for chunk in chunk_*; do
  bpm-escrime --import-fff "$chunk" --competition-id "large_2024"
done
```

**BPM - Escrime Features**:
- Optimized large dataset handling
- Progress indicators for imports
- Batch processing capabilities

#### Scenario 2: Custom Plugin Data

**Original Setup**:
- Custom ranking calculation plugin
- Special scoring rules
- Custom export formats

**Migration Strategy**:
1. **Document Plugin Logic**
   - Write down calculation formulas
   - Note special rules
   - Identify configuration

2. **Recreate in BPM - Escrime**
   - Use custom competition settings
   - Implement special scoring if needed
   - Create custom export templates

3. **Alternative: Feature Request**
   - Submit feature request to BPM - Escrime
   - Provide detailed requirements
   - Consider contributing code

#### Scenario 3: Historical Data Archive

**Requirement**: Access to 10 years of competition data

**Migration Plan**:
1. **Batch Export Automation**
   ```python
   # Python script to automate original software exports
   import subprocess
   import os
   
   competition_db_files = find_competition_databases("/path/to/original/data")
   
   for db_file in competition_db_files:
       export_path = f"migrated/{os.path.basename(db_file)}.xml"
       subprocess.run([
           "original-software",
           "--export-xml",
           db_file,
           "--output", export_path
       ])
   ```

2. **Convert and Archive**
   - Import XML files to BPM - Escrime
   - Archive in standardized format
   - Create searchable index

3. **Validation**
   - Spot-check random competitions
   - Verify data integrity
   - Create access procedures

## 🖥️ Interface Differences

### Navigation and Workflow

#### Original software Interface
```
┌─────────────────────────────────────────────┐
│ BPM - Escrime                    File Help    │
├─────────────────────────────────────────────┤
│ [New] [Open] [Save] [Export]              │
│                                           │
│ Competition Tree:                          │
│ ├─ 2024 Competitions                      │
│ │  ├─ Regional Championship               │
│ │  └─ Youth Tournament                   │
│ └─ 2023 Competitions                      │
│                                           │
│ Main Panel:                               │
│ [Fencers] [Pools] [Tableau] [Results]    │
│                                           │
│ ┌─────────────────────────────────────────┐ │
│ │                                     │ │
│ │    Competition Details                │ │
│ │                                     │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

#### BPM - Escrime Interface
```
┌─────────────────────────────────────────────────────────────┐
│ 🤺 BPM - Escrime                    ☰ Help □ □ ⊗       │
├─────────────────────────────────────────────────────────────┤
│ [+ New Competition]           [🔍 Search]        [⚙️]     │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🏅 Regional Championship - Épée                      │ │
│ │ Date: 2024-03-15 | Fencers: 24 | Status: In Progress │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ │ 📋 Check-in  │ 🏊 Pools  │ 🏆 Tableau  │ 📊 Results  │ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │                                                     │ │
│ │                Current View Content                   │ │
│ │                                                     │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Key Interface Changes

#### 1. Tab-Based Navigation
**Original**: Menu-driven, separate windows
**Modern**: Tab-based, single interface

#### 2. Real-time Updates
**Original**: Manual refresh
**Modern**: Real-time updates, auto-save

#### 3. Search and Filter
**Original**: Basic navigation
**Modern**: Advanced search, filters, sorting

#### 4. Status Indicators
**Original**: Limited feedback
**Modern**: Visual status indicators, progress bars

### Menu System Changes

#### Original software Menu
```
File   Edit   View   Tools   Help
├─ New Competition
├─ Open Competition
├─ Save Competition
├─ Export Results
├─ Import Fencers
└─ Exit
```

#### BPM - Escrime Menu
```
☰ Menu
├─ Competition
│  ├─ New Competition
│  ├─ Import Competition
│  ├─ Export Results
│  └─ Close Competition
├─ Edit
│  ├─ Undo
│  ├─ Redo
│  └─ Preferences
├─ View
│  ├─ Zoom In/Out
│  ├─ Full Screen
│  └─ Developer Tools
├─ Tools
│  ├─ Remote Scoring
│  ├─ Competition Templates
│  └─ Database Manager
└─ Help
   ├─ User Manual
   ├─ Report Bug
   ├─ Check for Updates
   └─ About
```

## ⚠️ Common Migration Issues

### Issue 1: XML Parsing Errors

**Symptoms**:
- "Invalid XML format" error
- Competition data not importing
- Specific elements failing to parse

**Causes**:
- XML version incompatibility
- Encoding issues
- Custom tags not supported

**Solutions**:

#### Fix XML Encoding
```bash
# Check and fix encoding
file -I competition.xml
iconv -f ISO-8859-1 -t UTF-8 competition.xml > competition_utf8.xml
```

#### Manual XML Cleanup
```xml
<!-- Remove problematic elements -->
<CustomPluginData>...</CustomPluginData>

<!-- Fix namespace issues -->
<bpm-escrime:Competition xmlns:bpm-escrime="...">
```

#### Use FFF Import Instead
If XML has issues:
1. Export fencers as FFF from original
2. Import FFF to BPM - Escrime
3. Recreate competition manually

### Issue 2: Fencer Ranking Mismatches

**Symptoms**:
- Rankings differ between systems
- Pool calculations give different results
- Ties handled differently

**Causes**:
- Different ranking algorithms
- Rounding differences
- Tie-breaking rules variations

**Solutions**:

#### Verify Ranking Formula
BPM - Escrime uses official FIE rules:
```
Indicator = (Touches Given - Touches Received) + (Victories × 5)
```

#### Check Pool Settings
Ensure identical settings:
- Pool size
- Victory points
- Maximum score
- Tie-breaking rules

#### Manual Comparison
Export both versions to CSV:
```csv
Rank,Name,Club,V,M,TD,TR,Indicator
1,MOREAU Luc,Paris Escrime,5,0,25,5,20.00
```

### Issue 3: Special Characters Lost

**Symptoms**:
- Accented characters missing
- Names showing as question marks
- Club names corrupted

**Causes**:
- Encoding mismatches
- BOM (Byte Order Mark) issues
- Character set incompatibility

**Solutions**:

#### Force UTF-8 Encoding
```bash
# Convert to UTF-8 with BOM
echo -e "\xEF\xBB\xBF$(cat competition.xml)" > competition_utf8bom.xml
```

#### Use Text Editor
1. Open file in Notepad++ or VS Code
2. Convert encoding to UTF-8
3. Save with UTF-8 encoding
4. Import again

#### Manual Correction
For small datasets, edit names manually in BPM - Escrime interface.

### Issue 4: Performance with Large Files

**Symptoms**:
- Application freezes during import
- Memory usage spikes
- Long processing times

**Solutions**:

#### Split Large Files
```bash
# Split FFF file into chunks of 100 fencers
split -l 100 large_file.fff chunk_

# Import chunks sequentially
```

#### Use Competition Templates
1. Create competition template
2. Import small batches
3. Merge data in BPM - Escrime

#### Optimize System Resources
- Close other applications
- Increase virtual memory
- Use SSD for better I/O

## 📚 Learning Resources

### Documentation

1. **User Manual** - Complete guide to BPM - Escrime features
2. **Installation Guide** - Setup and system requirements
3. **Troubleshooting Guide** - Common issues and solutions
4. **File Format Specifications** - Supported import/export formats

### Video Tutorials

1. **Migration Overview** - High-level migration process
2. **Data Import Tutorial** - Step-by-step import guide
3. **Interface Tour** - BPM - Escrime interface walkthrough
4. **Remote Scoring Setup** - Modern remote scoring features

### Training Materials

#### For Tournament Organizers
- Migration checklist
- Comparison sheet (old vs new features)
- Quick reference guide
- Common workflows

#### For Technical Staff
- API documentation
- Integration guides
- Troubleshooting procedures
- System requirements

### Support Channels

#### Built-in Support
- **Bug Reporter**: Menu → Help → Report Bug (Ctrl+Shift+I)
- **System Info**: Menu → Help → System Information
- **Update Checker**: Automatic update notifications

#### Community Support
- **GitHub Issues**: Report bugs and request features
- **GitHub Discussions**: Ask questions and share experiences
- **Documentation Wiki**: Community-contributed guides

#### Professional Support
- Email support for licensed users
- Priority bug fixing
- Custom feature development
- On-site training available

## 📋 Migration Checklist

### Pre-Migration Preparation

- [ ] Backup original software data
- [ ] Install BPM - Escrime on test machine
- [ ] Document current workflows
- [ ] List active competitions
- [ ] Identify special requirements

### Data Export

- [ ] Export all active competitions to XML
- [ ] Export fencer lists to FFF format
- [ ] Export historical results to CSV
- [ ] Validate exported files
- [ ] Organize migration files

### Migration Execution

- [ ] Create test competitions in BPM - Escrime
- [ ] Import sample data
- [ ] Verify data integrity
- [ ] Test all features
- [ ] Train users on new interface

### Post-Migration

- [ ] Archive original data
- [ ] Document new workflows
- [ ] Update standard operating procedures
- [ ] Monitor system performance
- [ ] Collect user feedback

### Ongoing

- [ ] Regular backups in BPM - Escrime
- [ ] Keep software updated
- [ ] Monitor for issues
- [ ] Provide user training
- [ ] Evaluate new features

---

## 🎯 Migration Success Tips

1. **Start Small**: Test with small competitions first
2. **Train Early**: Begin user training before full migration
3. **Document Everything**: Keep detailed migration records
4. **Have Rollback Plan**: Know how to revert if needed
5. **Use Support**: Don't hesitate to ask for help

BPM - Escrime is designed to make the migration process as smooth as possible while providing significant improvements in functionality and user experience. The investment in migration pays off quickly through improved efficiency and modern features.

**Need Help?** Contact our support team through the built-in bug reporter or GitHub discussions for personalized migration assistance.